import { ACP_AGENTS, type AcpAgentId } from "./agents";
import { onAgentIdle, runningProcesses } from "./connection";
import { installAgent, isInstalling } from "./install";
import { brokenInstall, packageVersion, resolveAcp } from "./launch";
import { forgetOffer } from "./models";
import { AGENT_SOURCES, highestInCaret, isNewer, trackedPackages } from "./packages";

/* ---------------------------------------------------------------------------
   Keeping the installed agents current, on their own.

   A subscription agent's model list lives in the package we installed: for
   Claude, in the Agent SDK (an override of the adapter). When Anthropic
   ships a model, a new SDK release carries it, WITHIN the range of
   `packages.ts` — but npm never goes back for it: its lock file keeps the
   version of the day of the install. So Opus 5.5 was out and the app still
   offered Opus 5.

   So, every six hours while the app runs (and at the first status read),
   we ask the npm registry for the latest release within each range of an
   agent WE installed (never a CLI the user installed globally: theirs to
   update), and install it — pinned to that exact version, which is what
   makes npm move. Only while none of that agent's processes run: a
   running binary cannot be replaced (Windows) and a half-replaced install
   is worse than an old one. A busy agent is updated as soon as its last
   process exits; meanwhile its « Update » button shows.
   After an update the model offer is forgotten, so the next read of the
   models comes from the new version.

   Only a newer version WITHIN the range is taken. A range that must move
   (the next 0.x minor, a major) may break the adapter: that stays a
   release of BytNode-AI, which raises it in `packages.ts`.
--------------------------------------------------------------------------- */

const CHECK_EVERY = 6 * 60 * 60_000;
const RETRY_AFTER = 30 * 60_000;
const TICK = 60 * 60_000;
const REGISTRY = "https://registry.npmjs.org";

/** Per agent: the exact versions of a newer release found by the last check. */
const newer = new Map<AcpAgentId, Record<string, string>>();
/** Agents whose update was started since the last check: a failure is not
    retried at every status read, only after the next check. */
const attempted = new Set<AcpAgentId>();
let nextCheck = 0;
let checking: Promise<void> | null = null;
let ticker: NodeJS.Timeout | null = null;

/** The versions of a package on the registry (the abbreviated document). */
async function registryVersions(pkg: string): Promise<string[]> {
  const res = await fetch(`${REGISTRY}/${pkg.replace("/", "%2F")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`npm registry: ${res.status} for ${pkg}`);
  const json = (await res.json()) as { versions?: Record<string, unknown> };
  return Object.keys(json.versions ?? {});
}

/** What a newer release within the ranges would pin, for one agent we
    installed. Empty: up to date. */
async function pinsFor(agent: AcpAgentId): Promise<Record<string, string>> {
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "npm" || resolveAcp(agent)?.source !== "installed" || brokenInstall(agent)) return {};
  const pins: Record<string, string> = {};
  await Promise.all(
    trackedPackages(src).map(async ([pkg, range]) => {
      const got = packageVersion(agent, pkg);
      if (!got) return;
      const best = highestInCaret(await registryVersions(pkg), range);
      if (best && isNewer(best, got)) pins[pkg] = best;
    }),
  );
  return pins;
}

async function check(): Promise<void> {
  try {
    const found = await Promise.all(ACP_AGENTS.map(async (a) => [a.id, await pinsFor(a.id)] as const));
    newer.clear();
    attempted.clear();
    for (const [agent, pins] of found) if (Object.keys(pins).length) newer.set(agent, pins);
    nextCheck = Date.now() + CHECK_EVERY;
  } catch {
    /* offline, registry down: try again later, keep what we knew */
    nextCheck = Date.now() + RETRY_AFTER;
  }
}

/* An update that waited for a busy agent runs as soon as it stops. */
onAgentIdle(() => apply());

/** Install every update found whose agent is idle. */
function apply() {
  for (const [agent, pins] of newer) {
    if (attempted.has(agent) || isInstalling(agent) || runningProcesses(agent) > 0) continue;
    attempted.add(agent);
    void updateAgent(agent, pins).catch(() => {});
  }
}

/** Install an agent, or update it: to the exact versions found newer, if
    any. The route's « Install » / « Update » button goes through here too. */
export function updateAgent(agent: AcpAgentId, pins = newer.get(agent) ?? {}): Promise<void> {
  return installAgent(agent, pins).then(() => {
    newer.delete(agent);
    forgetOffer(agent);
  });
}

/** A newer release within the range is known for this agent. */
export const updateAvailable = (agent: AcpAgentId) => newer.has(agent);

/** Check if due (waiting at most `wait` ms for the registry), then start
    the updates that can run. Called at each status read; arms the hourly
    tick so a server left running keeps checking. */
export async function keepAgentsCurrent(wait = 3000): Promise<void> {
  if (!ticker) ticker = setInterval(() => void keepAgentsCurrent(0), TICK).unref();
  /* A check that outlasts `wait` still applies what it finds when it ends. */
  if (!checking && Date.now() >= nextCheck) checking = check().then(apply).finally(() => (checking = null));
  if (checking && wait > 0) await Promise.race([checking, new Promise((r) => setTimeout(r, wait).unref())]);
  apply();
}
