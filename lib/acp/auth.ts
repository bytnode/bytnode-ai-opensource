import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthMethod } from "@agentclientprotocol/sdk";
import {
  ACP_AGENTS,
  acpAgentInfo,
  type AcpAgentId,
  type AcpAuthStatus,
} from "./agents";
import { AcpConnection } from "./connection";
import { installFailure, isInstalling } from "./install";
import { acpLaunch, brokenInstall, cliLaunch, installedVersion, isInstalled, openTerminal, openTerminalWith, packageVersion, resolveAcp, runCli, subscriptionEnv } from "./launch";
import { AGENT_SOURCES, satisfiesCaret, trackedPackages } from "./packages";
import { keepAgentsCurrent, updateAvailable } from "./updates";
import { prepareWorkspace, scratchWorkspace } from "./prepare";

/* ---------------------------------------------------------------------------
   The account behind each agent: signed in or not, sign in, sign out.

   Three agents have a CLI that answers quickly (Claude: `auth status` in
   JSON; Codex: `login status`; Gemini: a credentials file). The others go
   through the protocol itself: a probe session that succeeds = signed in,
   an « authentication required » error = not signed in; to sign in, the
   method the agent announces at `initialize` — either it opens the browser
   itself (`authenticate`), or it asks for a terminal (`copilot login`).
   The rest of the application only sees `AcpAuthStatus`.
--------------------------------------------------------------------------- */

const CONNECTING_TTL = 10 * 60_000;
const connecting = new Map<AcpAgentId, number>();

const isConnecting = (agent: AcpAgentId) => {
  const since = connecting.get(agent);
  if (since === undefined) return false;
  if (Date.now() - since > CONNECTING_TTL) {
    connecting.delete(agent);
    return false;
  }
  return true;
};

export async function authStatus(agent: AcpAgentId): Promise<AcpAuthStatus> {
  const resolved = resolveAcp(agent);
  if (!resolved) {
    return { agent, available: false, installing: isInstalling(agent), loggedIn: false, message: installFailure(agent) ?? brokenInstall(agent) };
  }
  /* A launch that fails (unreadable binary, ENOENT) is a state to display,
     not an exception: otherwise the background fill crashes and the page
     stays on « checking ». */
  const known = { agent, available: true, source: resolved.source, outdated: isOutdated(agent) || updateAvailable(agent), build: buildOf(agent) } as const;
  /* During an update the agent is not launched to read its account: the
     binary is being replaced. Its last known state stands in. */
  if (isInstalling(agent)) return { ...(last.get(agent) ?? { loggedIn: false }), ...known, installing: true };
  let base: Partial_;
  try {
    base = await (STATUS[agent] ?? genericStatus(agent))();
  } catch (e) {
    base = { loggedIn: false, message: `Could not verify: ${e instanceof Error ? e.message : String(e)}` };
  }
  const status: AcpAuthStatus = { ...known, ...base };
  if (status.loggedIn) connecting.delete(agent);
  else status.connecting = isConnecting(agent);
  last.set(agent, status);
  return status;
}

const last = new Map<AcpAgentId, AcpAuthStatus>();

/** The versions of what we installed for this agent: it changes with an
    update, and the model catalog reloads on that change. */
function buildOf(agent: AcpAgentId): string | undefined {
  const src = AGENT_SOURCES[agent];
  if (src.kind !== "npm") return undefined;
  return trackedPackages(src).map(([pkg]) => `${pkg}@${packageVersion(agent, pkg) ?? "-"}`).join(" ");
}

/* The expected range was raised by a version of BytNode-AI (new models,
   efforts): the button becomes « Update ». A newer release within the
   range shows it too (`updateAvailable`), while it waits for the agent to
   be idle. */
const isOutdated = (agent: AcpAgentId): boolean => {
  const src = AGENT_SOURCES[agent];
  const got = installedVersion(agent);
  return src.kind === "npm" && got !== null && !satisfiesCaret(got, src.version);
};

/* The status read is also when the installed agents are brought up to
   date (`updates.ts`): an update it starts shows as `installing`, which
   keeps the page polling until the new version answers. */
export async function allAuthStatus() {
  await keepAgentsCurrent();
  return Promise.all(ACP_AGENTS.map((a) => authStatus(a.id)));
}

type Partial_ = {
  loggedIn: boolean;
  account?: string | null;
  message?: string | null;
  checking?: boolean;
};

const STATUS: Partial<Record<AcpAgentId, () => Promise<Partial_>>> = {
  async claude() {
    const { out } = await runCli("claude", ["auth", "status"]);
    const json = out.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return { loggedIn: false, message: out.trim() || null };
    try {
      const s = JSON.parse(json) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
        authMethod?: string;
      };
      const plan = s.subscriptionType ? ` · ${s.subscriptionType}` : "";
      return {
        loggedIn: !!s.loggedIn,
        account: s.loggedIn
          ? `${s.email ?? s.authMethod ?? "account"}${plan}`
          : null,
      };
    } catch {
      return { loggedIn: false, message: "Unreadable answer from Claude Code." };
    }
  },
  async openai() {
    const { out } = await runCli("openai", ["login", "status"]);
    const text = out.trim();
    if (/not logged in/i.test(text)) return { loggedIn: false };
    if (/logged in/i.test(text))
      return {
        loggedIn: true,
        account: text.replace(/^logged in\s*/i, "") || "ChatGPT",
      };
    return { loggedIn: false, message: text || null };
  },
  async gemini() {
    try {
      await fs.access(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
      return { loggedIn: true, account: "Google account" };
    } catch {
      return { loggedIn: false };
    }
  },
};

/* --- Through the protocol ------------------------------------------------ */

const PROBE_TTL = 90_000;
/* An agent that does not answer `session/new` (it is waiting for an
   interactive sign-in, it is stuck) must not leave the state on « checking »
   forever. */
const PROBE_TIMEOUT = 45_000;
const probeCache = new Map<AcpAgentId, { at: number; result: Partial_ }>();
const probeInflight = new Map<AcpAgentId, Promise<Partial_>>();

export const forgetStatus = (agent: AcpAgentId) => probeCache.delete(agent);

const looksLikeAuth = (msg: string) =>
  /auth|api key|sign in|log ?in|credential/i.test(msg);

/* ⚠️ THE PAGE NEVER WAITS. Probing an agent through the protocol costs a
   few seconds (a sub-process to spawn): the first read returns « checking »
   and the real answer arrives in the background; after that the cache
   answers at once, and a stale value is served as is while it is being
   refreshed. */
function genericStatus(agent: AcpAgentId): () => Promise<Partial_> {
  return async () => {
    const hit = probeCache.get(agent);
    if (hit) {
      if (Date.now() - hit.at >= PROBE_TTL) void probe(agent);
      return hit.result;
    }
    void probe(agent);
    return { loggedIn: false, checking: true };
  };
}

function probe(agent: AcpAgentId): Promise<Partial_> {
  const running = probeInflight.get(agent);
  if (running) return running;
  const p = (async (): Promise<Partial_> => {
    let result: Partial_;
    try {
      const cwd = await scratchWorkspace();
      await prepareWorkspace(agent, cwd);
      const conn = await AcpConnection.open(agent, cwd);
      try {
        await Promise.race([
          conn.newSession(cwd, []),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The agent is not responding.")), PROBE_TIMEOUT).unref()),
        ]);
        result = { loggedIn: true, account: acpAgentInfo(agent).plan };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = looksLikeAuth(msg)
          ? { loggedIn: false }
          : { loggedIn: false, message: msg };
      } finally {
        conn.close();
      }
    } catch (e) {
      result = {
        loggedIn: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
    probeCache.set(agent, { at: Date.now(), result });
    return result;
  })();
  probeInflight.set(agent, p);
  p.finally(() => probeInflight.delete(agent));
  return p;
}

/** Starts the sign-in and returns at once: the state is then read by
    polling `authStatus` until it says « signed in ». */
export async function startLogin(agent: AcpAgentId): Promise<void> {
  if (!isInstalled(agent))
    throw new Error("Agent missing: install it first.");
  connecting.set(agent, Date.now());
  probeCache.delete(agent);
  await (LOGIN[agent] ?? genericLogin(agent))();
}

const LOGIN: Partial<Record<AcpAgentId, () => Promise<void>>> = {
  async claude() {
    openTerminalWith("claude", ["auth", "login"], "Claude sign-in");
  },
  async openai() {
    /* `codex login` opens the browser, then waits for the callback on its
       local port: no terminal needed, we let it live in the background. */
    const { command, args } = cliLaunch("openai");
    const child = spawn(command, [...args, "login"], {
      env: subscriptionEnv(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  },
};

/** The sign-in method to keep among those the agent announces: a personal
    account / browser above all, never an API key. */
function pickAuthMethod(methods: AuthMethod[]): AuthMethod | null {
  const score = (m: AuthMethod) => {
    const text = `${m.id} ${m.name} ${m.description ?? ""}`.toLowerCase();
    if (
      /api.?key|gateway|vertex|agent.platform|enterprise|business|device/.test(
        text,
      )
    )
      return 0;
    if (/personal|browser|oauth|log ?in|sign ?in|studio/.test(text)) return 2;
    return 1;
  };
  return (
    [...methods]
      .sort((a, b) => score(b) - score(a))
      .find((m) => score(m) > 0) ?? null
  );
}

function genericLogin(agent: AcpAgentId): () => Promise<void> {
  return async () => {
    const cwd = await scratchWorkspace();
    await prepareWorkspace(agent, cwd);
    const conn = await AcpConnection.open(agent, cwd);
    const method = pickAuthMethod(conn.authMethods);
    if (!method) {
      conn.close();
      throw new Error(
        `${acpAgentInfo(agent).label} offers no account-based sign-in.`,
      );
    }
    const terminal = terminalAuthOf(method);
    if (terminal) {
      /* The agent wants a terminal: we open one and let it do its thing. */
      conn.close();
      const own = acpLaunch(agent);
      const command = terminal.command || own.command;
      const args = terminal.command
        ? terminal.args
        : [
            ...own.args.slice(0, own.command === process.execPath ? 1 : 0),
            ...terminal.args,
          ];
      openTerminal(
        command,
        args,
        `${acpAgentInfo(agent).label} sign-in`,
        terminal.env,
      );
      return;
    }
    /* The agent handles everything: it opens the browser and only answers
       once the account is linked. We do not wait here — the state is
       re-read. */
    void conn
      .authenticate(method.id)
      .catch(() => {})
      .finally(() => {
        conn.close();
        connecting.delete(agent);
        probeCache.delete(agent);
      });
  };
}

type TerminalAuth = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** A « terminal » method, in its two forms (the normalised `type` field,
    or Zed's `terminal-auth` metadata). */
function terminalAuthOf(method: AuthMethod): TerminalAuth | null {
  const meta = (method._meta as Record<string, unknown> | null | undefined)?.[
    "terminal-auth"
  ];
  if (meta && typeof meta === "object") {
    const m = meta as {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (m.command)
      return { command: m.command, args: m.args ?? [], env: m.env ?? {} };
  }
  if ("type" in method && method.type === "terminal") {
    const m = method as {
      args?: string[] | null;
      env?: { name: string; value: string }[] | null;
    };
    /* No command: it is the agent itself, with these arguments. */
    return {
      command: "",
      args: m.args ?? [],
      env: Object.fromEntries((m.env ?? []).map((e) => [e.name, e.value])),
    };
  }
  return null;
}

export async function logout(agent: AcpAgentId): Promise<void> {
  connecting.delete(agent);
  /* The cache is cleared ONLY once the sign-out succeeded. Clearing it
     first is what produced the loop the user sees: a failed sign-out still
     re-probed, showed « Reading… », found the account intact and put
     « Sign out » back with nothing said. Left in place, the state stays
     true and the panel shows the reason. */
  await (LOGOUT[agent] ?? genericLogout(agent))();
  probeCache.delete(agent);
}

/** A CLI sign-out that really signed out. ⚠️ THE EXIT CODE IS THE ONLY
    PROOF: `logout` clears the probe cache, so a sign-out that silently did
    nothing shows « Reading… », re-probes, finds the account still there
    and springs the button back to « Sign out » — the user sees a loop with
    no explanation. A refusal must reach the panel. */
async function cliLogout(agent: AcpAgentId, args: string[]): Promise<void> {
  const { code, out } = await runCli(agent, args);
  if (code !== 0) throw new Error(`${acpAgentInfo(agent).label} refused to sign out: ${out.trim().slice(-200) || `exit code ${code}`}`);
}

const LOGOUT: Partial<Record<AcpAgentId, () => Promise<void>>> = {
  async claude() {
    await cliLogout("claude", ["auth", "logout"]);
  },
  async openai() {
    await cliLogout("openai", ["logout"]);
  },
  async gemini() {
    await fs.rm(path.join(os.homedir(), ".gemini", "oauth_creds.json"), {
      force: true,
    });
  },
  async copilot() {
    await cliLogout("copilot", ["logout"]);
  },
  /* `grok logout` — « Sign out and clear cached credentials », which also
     empties `~/.grok/auth.json`. Without this entry grok fell through to
     `genericLogout`, and Grok Build does not implement the protocol's
     optional `logout`: signing out was a no-op. */
  async grok() {
    await cliLogout("grok", ["logout"]);
  },
};

/** ⚠️ `logout` IS OPTIONAL IN ACP AND NOTHING ADVERTISES IT — there is no
    capability to test, so the only way to know is to call it and read the
    refusal. This used to swallow that refusal, which reported a sign-out
    that never happened. We now say it, and name the way out when the agent
    has one. */
function genericLogout(agent: AcpAgentId): () => Promise<void> {
  return async () => {
    const cwd = await scratchWorkspace();
    const conn = await AcpConnection.open(agent, cwd);
    try {
      await conn.logout();
    } catch {
      throw new Error(`Could not sign out of ${acpAgentInfo(agent).label} — this agent offers no sign-out.`);
    } finally {
      conn.close();
    }
  };
}
