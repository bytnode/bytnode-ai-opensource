import path from "node:path";
import type { PluginsState } from "@/lib/domain/plugins";
import { bytnodeAiTools, generalTools } from "@/lib/tools/registry";
import { OPEN_VIEW } from "@/lib/tools/views/open-view";
import { PLUGINS } from "./definitions";
import { setActiveRuntime, setUserPluginsReloader } from "./core/active";
import { requestConfirmation } from "./core/confirmations";
import type { Session } from "./core/contract";
import { addNotification } from "./core/notifications";
import { PluginRuntime, type RuntimeEnv } from "./core/runtime";
import { SessionHolder } from "./core/session";
import { pluginStore, pluginsDir, readJson, writeJsonAtomic } from "./core/store";
import { userPluginStore, userPluginsVersion } from "./user/files";
import { isUserPluginId } from "./user/manifest";
import type { Keys } from "./user/host-ops";
import { userDefinitions } from "./user/load";

/* ---------------------------------------------------------------------------
   Where the plugin runtime lives.

   - The Next server has ONE host (`pluginHost`), kept on `globalThis`: the
     runtime with the background, the session's keys in memory, and the
     plugins' state. That state comes from the browser's settings (sent
     with the session); a copy without any secret is kept on disk
     (`plugins/state.json`) so a restart knows which plugins to start before
     a tab speaks.
   - The MCP server of a subscription session starts a runtime of its own
     (`startToolsRuntime`): the same plugins, tools only, no background.
--------------------------------------------------------------------------- */

const KEY = Symbol.for("bytnode-ai.plugins.host");

export type Host = {
  runtime: PluginRuntime;
  session: SessionHolder;
  /** The first `apply` (from the disk copy): awaited before serving. */
  ready: Promise<void>;
  /** The definitions it was built from: in development, a reloaded module
      brings new ones, and the host is rebuilt around them. */
  definitions: typeof PLUGINS;
  /** The plugins written by agents, as last loaded (`userPluginsVersion`). */
  userVersion: string;
  /** Looks at them every `WATCH_MS`: one activated by a subscription
      agent's MCP server (another process) runs here within seconds. */
  watch?: ReturnType<typeof setInterval>;
};

const WATCH_MS = 2_000;

const mirrorFile = () => path.join(pluginsDir(), "state.json");

/** The names no plugin may take: every core tool, and OpenView. */
function coreToolNames(): Set<string> {
  const account = { id: "", exchange: "binance", label: "", apiKey: "", secret: "", password: "", testnet: true };
  return new Set([...generalTools(process.platform), ...bytnodeAiTools({ exchangeAccounts: [account] })].map((t) => t.name).concat(OPEN_VIEW));
}

function env(background: boolean, session: () => Session | null): RuntimeEnv {
  return {
    background,
    reservedNames: coreToolNames(),
    /* A plugin written by an agent keeps its data in its own folder. */
    store: (id) => (isUserPluginId(id) ? userPluginStore(id) : pluginStore(id)),
    notifications: { add: addNotification },
    confirmations: { request: requestConfirmation },
    session,
    log: (message) => console.info(message),
  };
}

type Holder = { [KEY]?: Host };

export function pluginHost(): Host {
  const holder = globalThis as Holder;
  const current = holder[KEY];
  if (current?.definitions === PLUGINS) return current;
  /* First call — or, in development, the plugin modules were reloaded: the
     old runtime stops (its timers with it), the session's keys are kept. */
  if (current) {
    if (current.watch) clearInterval(current.watch);
    void current.runtime.shutdown();
  }
  const session = current?.session ?? new SessionHolder();
  const runtime = new PluginRuntime(PLUGINS, env(true, () => session.get()));
  setActiveRuntime(runtime);
  const host: Host = { runtime, session, ready: Promise.resolve(), definitions: PLUGINS, userVersion: "" };
  /* The plugins written by agents join before the first `apply`, so they
     start with the others. */
  host.ready = loadUser(host)
    .catch((e: unknown) => console.info(`[plugins] the plugins written by agents could not be read: ${e instanceof Error ? e.message : String(e)}`))
    .then(() => readJson<PluginsState>(mirrorFile(), {}))
    .then((state) => runtime.apply(state));
  setUserPluginsReloader(() => loadUser(host, true));
  host.watch = setInterval(() => void host.ready.then(() => loadUser(host)).catch(() => {}), WATCH_MS);
  host.watch.unref?.();
  holder[KEY] = host;
  return host;
}

/** Reads the approved plugins written by agents and hands the runtime the
    whole set; skipped when nothing changed on disk (unless `force`). */
async function loadUser(host: Host, force = false): Promise<void> {
  const version = userPluginsVersion();
  if (!force && version === host.userVersion) return;
  host.userVersion = version;
  const { definitions } = await userDefinitions();
  await host.runtime.replaceDefinitions([...PLUGINS, ...definitions]);
}

/** The runtime, once it has started what the disk copy says. */
export async function readyRuntime(): Promise<PluginRuntime> {
  const host = pluginHost();
  await host.ready;
  return host.runtime;
}

/** A tab speaks: its keys for the background, and the plugins' state —
    applied, and copied to disk when it changed. */
export async function syncSession(session: Session): Promise<void> {
  const host = pluginHost();
  await host.ready;
  host.session.set(session);
  /* An agent's plugin activated from another process (a subscription
     agent's MCP server) is picked up here, at the next heartbeat. */
  await loadUser(host).catch(() => {});
  const previous = await readJson<PluginsState>(mirrorFile(), {});
  if (JSON.stringify(previous) !== JSON.stringify(session.plugins)) await writeJsonAtomic(mirrorFile(), session.plugins);
  /* The host may have been replaced meanwhile (a reload): the state goes
     to the current one — the one replaced is shut down for good. */
  await pluginHost().runtime.apply(session.plugins);
}

/** The runtime of an MCP server: tools only, for the state it was given.
    `keys`: the agent's own (its environment) — the plugins written by
    agents use them, since no session reaches this process. */
export async function startToolsRuntime(state: PluginsState, keys?: Keys): Promise<PluginRuntime> {
  const fallbackKeys = () => keys ?? null;
  const { definitions } = await userDefinitions({ fallbackKeys }).catch(() => ({ definitions: [] }));
  const runtime = new PluginRuntime([...PLUGINS, ...definitions], env(false, () => null));
  setActiveRuntime(runtime);
  setUserPluginsReloader(async () => runtime.replaceDefinitions([...PLUGINS, ...(await userDefinitions({ fallbackKeys })).definitions]));
  await runtime.apply(state);
  return runtime;
}
