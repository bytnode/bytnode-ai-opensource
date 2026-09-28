import type { McpServer, PermissionOption, RequestPermissionRequest, RequestPermissionResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BYTNODE_MCP_URL, bytnodeTools } from "@/lib/mcp/bytnode";
import { financeServerArgs } from "@/lib/mcp/server-launch";
import type { ConfirmVerdict } from "@/lib/mcp/serve-call";
import { dataDir } from "@/lib/server/data-dir";
import { PROJECT_ROOT } from "@/lib/server/workspace";
import { loadProfession } from "@/lib/professions/load";
import { PROFESSIONS, type ProfessionId } from "@/lib/professions/catalog";
import { subagentFrame } from "@/lib/tools/agents/subagent";
import { resolvePolicy } from "@/lib/tools/policy";
import { allTools } from "@/lib/tools/registry";
import { userSkills, type SkillInfo } from "@/lib/tools/skills/skill";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { AcpConnection } from "./connection";
import { prepareWorkspace } from "./prepare";
import { buildAcpPrompt, wrapContext } from "./prompt";
import { syncSkills } from "./skills-sync";
import {
  DEFAULT_MODEL,
  effortsOfConfig,
  eventsOfUpdate,
  isServerConfirmedCall,
  isUngatedMcpCall,
  matchServedCall,
  mcpToolOf,
  OWN_MCP_SERVER,
  mergeCallInfo,
  permissionSubject,
  modelConfigId,
  modesOfSession,
  pickPermissionOption,
  TurnCost,
  turnMode,
  type AgentModes,
  type CallInfo,
} from "./translate";

/* ---------------------------------------------------------------------------
   One ACP session per conversation.

   The agent's sub-process lives as long as the conversation is active and
   dies after a quarter of an hour of silence. If it is dead when we come
   back, the session is reloaded (`session/load`): the agent replays its
   history — which we ignore, the thread already has it — and resumes
   where it was.

   A turn = one `session/prompt`. During the turn, the agent narrates
   (`session/update`) and sometimes asks for permission to act; those
   requests are shown on screen and wait for the user's answer, which
   arrives through another request (`answerPermission`).
--------------------------------------------------------------------------- */

import type { WireEvent } from "./wire";
import type { ExchangeAccount } from "@/lib/domain/types";
import { ALWAYS_ASK, isAlwaysAskTitle } from "@/lib/tools/names";
import { activeRuntime } from "@/lib/plugins/core/active";
import { pluginPrompt } from "@/lib/plugins/extras";
import { userPluginsVersion, verifiedGrantSigs } from "@/lib/plugins/user/files";
import { VERIFIED_GRANTS_ENV } from "@/lib/plugins/user/approval";
export type { WireEvent };

/** A call that commits funds, or whose tool always asks by its policy:
    it is never answered « always », never auto-allowed. Read in the title
    AND in the MCP tool behind the call: Codex titles an MCP call without
    the tool's name (its raw input carries it). */
const critical = (call: Pick<RequestPermissionRequest["toolCall"], "title" | "rawInput" | "_meta">) => {
  const extra = activeRuntime()?.alwaysAskTools() ?? [];
  return [call.title ?? "", mcpToolOf(call)?.tool ?? ""].some((n) => n !== "" && isAlwaysAskTitle(n, extra));
};

/** The tools that always ask: the core's floor and the plugins' own. */
const alwaysAskTools = () => [...ALWAYS_ASK, ...(activeRuntime()?.alwaysAskTools() ?? [])];

const selected = (optionId: string | null): RequestPermissionResponse =>
  optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };

export type TurnInput = {
  conversationId: string;
  agent: AcpAgentId;
  /** The BytNode-AI agent the conversation belongs to. */
  agentId: string;
  workspace: string;
  /** The server's origin (`http://localhost:3777`): the MCP server sends
      Workflow tasks back to it. */
  origin: string;
  bytnodeKey: string;
  /** The exchange accounts the agent may drive, for the MCP server. */
  exchangeAccounts: ExchangeAccount[];
  /** The plugins enabled for the agent (`null`: every running one). */
  plugins: string[] | null;
  /** BytNode-AI's system prompt (profile, profession, environment). */
  system: string;
  text: string;
  /** The model id as the agent knows it (no prefix), or null. */
  modelId: string | null;
  effort: string | null;
  /** The external agent's mode requested for this turn, if it publishes any. */
  mode: string | null;
  permissionMode: "ask" | "skip";
  /** The session remembered by the conversation, to reload if possible. */
  sessionId: string | null;
  /** True on the conversation's first message. */
  firstTurn: boolean;
  /** The images attached to the message, as data URLs. */
  images?: string[];
  /** The previous thread as text, for an agent that cannot reload. */
  history?: string;
};

type Pending = {
  options: PermissionOption[];
  resolve: (optionId: string | null) => void;
  /** A tool that commits funds: it does not accept « always ». */
  critical: boolean;
  /** BytNode-AI's own confirmation (`confirmCall`): the answer must carry
      this secret, which only the turn's stream showed. */
  nonce?: string;
};

type Live = {
  agent: AcpAgentId;
  agentId: string;
  /** The agent's plugins: its sub-agents get the same ones. */
  plugins: string[] | null;
  conn: AcpConnection;
  sessionId: string;
  cwd: string;
  configOptions: SessionConfigOption[];
  /** The old `models` field (Gemini CLI): the current model, if any. */
  legacyModel: string | null;
  /** The modes the session publishes, and the active one. */
  modes: AgentModes | null;
  /** The effort applied at creation (Claude): a change requires a new
      session. */
  effort: string | null;
  /** The MCP servers given at creation: if they change (BytNode key
      entered, new tools), the session is recreated — an agent does not
      discover a server mid-way. */
  serversKey: string;
  /** The servers and metadata given at creation, to resume the session
      the same way (`restartSession`). */
  servers: McpServer[];
  meta: Record<string, unknown> | undefined;
  /** The system prompt set at creation: if it changes (profession,
      context, skills), the session is recreated, otherwise the agent
      would carry on with the old profession. */
  system: string;
  lastUsed: number;
  busy: boolean;
  pending: Map<string, Pending>;
  /** True during `session/load`: the replayed updates are ignored. */
  loading: boolean;
  /** The session's running cost → each turn's. */
  cost: TurnCost;
  /** The mode the session was in before « Ask before acting » put it in
      the agent's asking mode (`askMode`), to go back to it. */
  modeBeforeAsk: string | null;
  /** A restart after a cancelled turn (`restartSession`), awaited by the
      next turn; false: it failed and the connection is closed. */
  restarting: Promise<boolean> | null;
  /** The server's origin, for the sub-agents' MCP servers. */
  origin: string;
  /** Resolved when our MCP server has served its tool list, for an agent
      that starts its MCP servers in the background (`LATE_MCP`); the first
      prompt waits for it. */
  toolsReady: Promise<void> | null;
};

const IDLE_TTL = 15 * 60_000;
const live = new Map<string, Live>();

/* ---------------------------------------------------------------------------
   The turn in progress on each conversation, from the moment its request
   arrives — BEFORE the session exists.

   ⚠️ THE SESSION TAKES SECONDS TO OPEN (5 to 50 s), and everything used to
   hang on the `Live` entry, which only exists once it is open: a Stop in
   that window was lost (the listener was registered after the opening, and
   an already-aborted signal never fires) and the prompt went out anyway —
   with a permission request nobody would ever answer, the conversation
   stayed « busy » forever; `/api/acp/cancel` found nothing to cancel; two
   prompts at once opened two sessions and leaked one process tree; and a
   prompt sent to a busy conversation whose session key had moved closed
   the running turn's session. One claim per conversation, taken first,
   settles all of it: a second prompt is refused at once, a cancel or a
   close is recorded and honoured as soon as the session is there.
--------------------------------------------------------------------------- */

export type TurnClaim = {
  readonly conversationId: string;
  /** Stop pressed / request closed / `/api/acp/cancel`. */
  cancelled: boolean;
  /** The conversation was deleted while the turn was starting. */
  closed: boolean;
  /** The session, once open. */
  live: Live | null;
  /** The prompt was sent: a cancel must reach the agent. */
  prompting: boolean;
  /** A `session/cancel` was sent during the prompt. */
  cancelSent: boolean;
  /** Resolved at the cancel: a wait before the prompt stops at once. */
  readonly stopped: Promise<void>;
  readonly stop: () => void;
  /** Asks the user, in this turn's thread, to confirm a money action our
      MCP server is about to run (`confirmCall`); null outside the prompt. */
  confirm: ((tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ConfirmVerdict>) | null;
  /** Resolved when the claim is released. */
  readonly released: Promise<void>;
  readonly markReleased: () => void;
};

const turns = new Map<string, TurnClaim>();

/** Takes the conversation for one turn; null if a turn is already in
    progress there. Released by `runTurn` (or `releaseTurn`). */
export function claimTurn(conversationId: string): TurnClaim | null {
  if (turns.has(conversationId)) return null;
  let stop = () => {};
  const stopped = new Promise<void>((resolve) => (stop = resolve));
  let markReleased = () => {};
  const released = new Promise<void>((resolve) => (markReleased = resolve));
  const claim: TurnClaim = { conversationId, cancelled: false, closed: false, live: null, prompting: false, cancelSent: false, stopped, stop, confirm: null, released, markReleased };
  turns.set(conversationId, claim);
  return claim;
}

export function releaseTurn(claim: TurnClaim): void {
  if (turns.get(claim.conversationId) === claim) turns.delete(claim.conversationId);
  claim.markReleased();
}

/** `claimTurn`, but a turn the user already STOPPED is waited for (up to
    `maxMs`) instead of refused. ⚠️ Stop closes the request at once, while
    the agent takes a few seconds to acknowledge the cancel (Claude also
    restarts its session): the next message got "already has a turn in
    progress" for 5–7 s. A turn that is genuinely running is still refused. */
export async function claimTurnAfterStop(conversationId: string, signal: AbortSignal, maxMs = 20_000): Promise<TurnClaim | null> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const claim = claimTurn(conversationId);
    if (claim) return claim;
    const current = turns.get(conversationId);
    const left = deadline - Date.now();
    if (!current || !current.cancelled || left <= 0 || signal.aborted) return null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, left);
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      signal.addEventListener("abort", done, { once: true });
      void current.released.then(done);
    });
  }
}

const BUSY = "This conversation already has a turn in progress.";

function cancelClaim(claim: TurnClaim): void {
  claim.cancelled = true;
  claim.stop();
  const l = claim.live;
  if (!l) return;
  if (claim.prompting && !claim.cancelSent) {
    claim.cancelSent = true;
    void l.conn.cancel(l.sessionId).catch(() => {});
  }
  for (const p of l.pending.values()) p.resolve(null);
  l.pending.clear();
}

/** Closes a session and forgets it — only if it is still the one the
    conversation holds: a newer session must never be dropped (leaked) by
    an older turn finishing. */
function dropLive(conversationId: string, l: Live): void {
  l.conn.close();
  if (live.get(conversationId) === l) live.delete(conversationId);
}

let reaper: NodeJS.Timeout | null = null;
function armReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, l] of live) {
      if (!l.busy && !turns.has(id) && now - l.lastUsed > IDLE_TTL) {
        l.conn.close();
        live.delete(id);
      }
    }
    if (live.size === 0 && reaper) {
      clearInterval(reaper);
      reaper = null;
    }
  }, 60_000).unref();
}

/* The MCP servers given to the external agent: BytNode (data) and
   BytNode-AI's own tools (the core's and the plugins'), served by a small
   stdio process in the workspace. */
/* The version of the tools' code: the date of the most recent file. It
   goes into the server's environment, hence into the session key — a
   change to the tools recreates the session, and the agent restarts the
   server with the up-to-date code instead of keeping the old process. */
function toolsVersion(): string {
  let latest = 0;
  const visit = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) visit(p);
      else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try {
    /* Everything the MCP server embeds: the tools (finance, exchange,
       their shared trunk), the plugins and the server itself. */
    visit(path.join(PROJECT_ROOT, "lib", "tools"));
    visit(path.join(PROJECT_ROOT, "lib", "plugins"));
    visit(path.join(PROJECT_ROOT, "lib", "mcp"));
  } catch {
    /* no big deal: the key just will not move */
  }
  /* And the plugins written by agents: one activated or removed restarts
     the server with its tools. */
  return `${Math.floor(latest)}.${userPluginsVersion()}`;
}

/* Where the first turn's time goes: each step is written to the `next dev`
   terminal (`[acp] …`). A slow first message is almost always the session
   opening — Claude Code waits for every MCP server to answer, including
   the remote BytNode — or the model's thinking before the first word. */
const clock = () => {
  const t0 = Date.now();
  return () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
};
const trace = (msg: string) => console.info(`[acp] ${msg}`);

/* The token that authorises a conversation's MCP server to launch
   sub-agents on its behalf: stable as long as the server runs (it goes
   into the session key), unknown to any other process. */
const tokens = new Map<string, string>();
const tokenFor = (conversationId: string) => {
  let t = tokens.get(conversationId);
  if (!t) tokens.set(conversationId, (t = randomUUID()));
  return t;
};

/* ---------------------------------------------------------------------------
   ⚠️ CODEX STARTS ITS MCP SERVERS IN THE BACKGROUND and does not wait for
   them: a prompt sent as soon as the session is open runs WITHOUT our
   tools when our server is not up yet (1-3 s from the bundle, up to 18 s
   through tsx on a busy machine) — « NO TOOL », and the model computed a
   position size by itself. It was seen after `session/load` (F3), and it
   happens on a fresh session just the same; with the server up, both
   work. Codex publishes no « ready » (only failures), so our server says
   it: once it has served its tool list, it calls `/api/acp/ready` with an
   id only this session knows, and the first prompt waits for that — at
   most `TOOLS_WAIT` (Codex gives up on a server after ~10 s anyway).
--------------------------------------------------------------------------- */

const LATE_MCP = new Set<AcpAgentId>(["openai"]);
const TOOLS_WAIT = 15_000;
/** Once the agent has registered the list it just received. */
const TOOLS_SETTLE = 400;
const toolsWaiters = new Map<string, () => void>();

function expectTools(id: string): Promise<void> {
  return new Promise((resolve) =>
    toolsWaiters.set(id, () => {
      toolsWaiters.delete(id);
      resolve();
    }),
  );
}

/** Our MCP server `id` has served its tools (`/api/acp/ready`). */
export function markToolsReady(id: string): boolean {
  const done = toolsWaiters.get(id);
  if (!done) return false;
  done();
  return true;
}

/** Waits for the tools, the cancel or the timeout; true if they came. */
async function waitForTools(ready: Promise<void>, stop: Promise<void>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    ready.then(() => "ready" as const),
    stop.then(() => "stopped" as const),
    new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), TOOLS_WAIT))),
  ]);
  clearTimeout(timer);
  if (outcome === "ready") await new Promise((resolve) => setTimeout(resolve, TOOLS_SETTLE));
  return outcome === "ready";
}

/** The MCP server of a main agent (depth 0, with Workflow and what it
    takes to call the server back) or of a sub-agent (depth 1: neither
    Workflow nor any tool that commits funds; `ready` when someone waits
    for its tools). */
type Depth = { depth: 0; conversationId: string; agent: AcpAgentId; origin: string } | { depth: 1; ready?: { origin: string; id: string } };

/** What the MCP server serves: the agent's keys, accounts and plugins —
    with the plugins' state, so its own runtime starts the same ones. A
    plugin switched on or off, or reconfigured, changes this environment,
    hence the session key: the session is recreated with the right tools. */
type Served = { workspace: string; bytnodeKey: string; exchangeAccounts: ExchangeAccount[]; plugins: string[] | null; agentId: string };

const mcpServersFor = ({ workspace, bytnodeKey, exchangeAccounts, plugins, agentId }: Served, depth: Depth): McpServer[] => {
  const parent =
    depth.depth === 0
      ? [
          { name: "BYTNODE_AI_PARENT", value: depth.conversationId },
          { name: "BYTNODE_AI_ACP_AGENT", value: depth.agent },
          { name: "BYTNODE_AI_ORIGIN", value: depth.origin },
          { name: "BYTNODE_AI_SUBAGENT_TOKEN", value: tokenFor(depth.conversationId) },
          ...(LATE_MCP.has(depth.agent) ? [{ name: "BYTNODE_AI_READY_ID", value: tokenFor(depth.conversationId) }] : []),
        ]
      : depth.ready
        ? [
            { name: "BYTNODE_AI_ORIGIN", value: depth.ready.origin },
            { name: "BYTNODE_AI_READY_ID", value: depth.ready.id },
          ]
        : [];
  const servers: McpServer[] = [
    {
      name: "bytnode-ai",
      command: process.execPath,
      /* The bundle prepack ships, or tsx on the source in development
         (`lib/mcp/server-launch.ts`: tsx cannot run it from node_modules). */
      args: financeServerArgs(PROJECT_ROOT),
      env: [
        { name: "BYTNODE_AI_WORKSPACE", value: workspace },
        { name: "BYTNODE_AI_PROJECT_ROOT", value: PROJECT_ROOT },
        { name: "BYTNODE_AI_HOME", value: dataDir() },
        { name: "BYTNODE_AI_BYTNODE_KEY", value: bytnodeKey.trim() },
        { name: "BYTNODE_AI_EXCHANGE_ACCOUNTS", value: exchangeAccounts.length ? JSON.stringify(exchangeAccounts) : "" },
        { name: "BYTNODE_AI_TOOLS_VERSION", value: toolsVersion() },
        { name: "BYTNODE_AI_DEPTH", value: String(depth.depth) },
        { name: "BYTNODE_AI_AGENT_ID", value: agentId },
        { name: "BYTNODE_AI_PLUGINS", value: plugins === null ? "" : JSON.stringify(plugins) },
        { name: "BYTNODE_AI_PLUGIN_STATE", value: JSON.stringify(activeRuntime()?.currentState ?? {}) },
        /* The agent-written plugins the user's browser approved — the key
           itself never leaves this process (`lib/plugins/user/approval.ts`). */
        { name: VERIFIED_GRANTS_ENV, value: JSON.stringify(verifiedGrantSigs()) },
        ...parent,
      ],
    },
  ];
  if (bytnodeKey.trim()) servers.push({ type: "http", name: "bytnode", url: BYTNODE_MCP_URL, headers: [{ name: "X-API-KEY", value: bytnodeKey.trim() }] });
  return servers;
};

/** What each agent accepts at session creation, outside the protocol. */
function sessionMeta(agent: AcpAgentId, input: Pick<TurnInput, "system" | "modelId" | "effort">): Record<string, unknown> | undefined {
  if (agent !== "claude") return undefined;
  /* Without the user's personal settings (`~/.claude/settings.json`):
     their allow rules and their model must not apply here — BytNode-AI
     decides, with its two modes. */
  /* And only OUR MCP servers: without `strictMcpConfig`, Claude Code also
     loads the connectors of the user's claude.ai account (Gmail,
     calendar…) — off-topic here, and dozens of tools of noise. */
  const options: Record<string, unknown> = { settingSources: ["project", "local"], strictMcpConfig: true };
  if (input.modelId) options.model = input.modelId;
  if (input.effort) options.effort = input.effort;
  return { systemPrompt: { append: input.system }, claudeCode: { options } };
}

async function ensureSession(input: TurnInput): Promise<{ l: Live; fresh: boolean; loaded: boolean }> {
  const current = live.get(input.conversationId);
  const servers = mcpServersFor(input, { depth: 0, conversationId: input.conversationId, agent: input.agent, origin: input.origin });
  const serversKey = JSON.stringify(servers);
  if (
    current &&
    current.conn.alive &&
    current.serversKey === serversKey &&
    current.system === input.system &&
    (current.agent !== "claude" || current.effort === input.effort)
  ) {
    const restarted = current.restarting ? await current.restarting : true;
    current.restarting = null;
    if (restarted && current.conn.alive) return { l: current, fresh: false, loaded: false };
  }
  /* No turn runs on it (the claim guarantees it): closing is safe. */
  if (current) dropLive(input.conversationId, current);
  await prepareWorkspace(input.agent, input.workspace);
  const opened = clock();
  const conn = await AcpConnection.open(input.agent, input.workspace);
  trace(`${input.agent}: process launched in ${opened()}`);
  const meta = sessionMeta(input.agent, input);
  const l: Live = {
    agent: input.agent,
    agentId: input.agentId,
    plugins: input.plugins,
    conn,
    sessionId: "",
    cwd: input.workspace,
    configOptions: [],
    legacyModel: null,
    modes: null,
    effort: input.effort,
    serversKey,
    servers,
    meta,
    system: input.system,
    lastUsed: Date.now(),
    busy: false,
    pending: new Map(),
    loading: false,
    cost: new TurnCost(),
    modeBeforeAsk: null,
    restarting: null,
    origin: input.origin,
    /* Armed BEFORE the agent can launch our server: its signal must not
       arrive before anyone listens. */
    toolsReady: LATE_MCP.has(input.agent) ? expectTools(tokenFor(input.conversationId)) : null,
  };
  let loaded = false;
  if (input.sessionId && conn.capabilities.loadSession) {
    try {
      l.loading = true;
      conn.listen(input.sessionId, () => {}, async () => ({ outcome: { outcome: "cancelled" } }));
      const res = await conn.loadSession(input.sessionId, input.workspace, servers, meta);
      l.sessionId = input.sessionId;
      l.configOptions = res.configOptions ?? [];
      l.legacyModel = legacyModelOf(res);
      l.modes = modesOfSession(res as Parameters<typeof modesOfSession>[0]);
      loaded = true;
    } catch {
      /* session unknown to the agent: we open a fresh one */
    } finally {
      l.loading = false;
      conn.listen(input.sessionId, null, null);
    }
  }
  if (!loaded) {
    try {
      const created = clock();
      const res = await conn.newSession(input.workspace, servers, meta);
      trace(`${input.agent}: session opened in ${created()} (MCP servers: ${servers.map((s) => s.name).join(", ") || "none"})`);
      l.sessionId = res.sessionId;
      l.configOptions = res.configOptions ?? [];
      l.legacyModel = legacyModelOf(res);
      l.modes = modesOfSession(res as Parameters<typeof modesOfSession>[0]);
    } catch (e) {
      conn.close();
      throw describe(e, conn);
    }
  }
  const stale = live.get(input.conversationId);
  if (stale && stale !== l) dropLive(input.conversationId, stale);
  live.set(input.conversationId, l);
  armReaper();
  return { l, fresh: !loaded, loaded };
}

/** A Claude session after a cancelled turn: closed and resumed (same id,
    same history, same process).
    ⚠️ AFTER A CANCEL, CLAUDE'S REPLIES SHIFTED BY ONE TURN. The adapter
    (claude-agent-acp 0.23.1) answers the cancelled `session/prompt` at the
    first result, and the end of the interrupted run stays queued: the next
    prompt consumed it and ended at once with NO text (161 ms), and the one
    after streamed both answers glued (« kiwimango »). Resuming the session
    drops that queue. Started as soon as the cancelled turn ends; the next
    turn waits for it. */
async function restartSession(l: Live): Promise<boolean> {
  const t = clock();
  try {
    await l.conn.closeSession(l.sessionId);
    const res = await l.conn.resumeSession(l.sessionId, l.cwd, l.servers, l.meta);
    l.configOptions = res.configOptions ?? l.configOptions;
    l.modes = modesOfSession(res as Parameters<typeof modesOfSession>[0]) ?? l.modes;
    /* A new run of the agent: its cost counter restarts. */
    l.cost = new TurnCost();
    trace(`${l.agent}: session restarted after a cancel in ${t()}`);
    return true;
  } catch (e) {
    trace(`${l.agent}: restart after a cancel failed (${e instanceof Error ? e.message : String(e)}): the session will be reopened`);
    l.conn.close();
    return false;
  }
}

const legacyModelOf = (res: unknown): string | null => {
  const m = (res as { models?: { currentModelId?: string } | null }).models;
  return m && typeof m.currentModelId === "string" ? m.currentModelId : null;
};

function describe(e: unknown, conn: AcpConnection): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const detail = conn.lastStderr;
  if (/auth/i.test(msg)) return new Error(`${acpAgentInfo(conn.agent).label} asks for an account sign-in: open Auth → Subscription.`);
  return new Error(detail ? `${msg}\n${detail}` : msg);
}

/** Puts the session in the mode the turn needs (`turnMode`). A mode the user
    picked is applied as is; with none, a failure to set the ASKING default
    refuses the turn — Codex never runs unguarded by default. */
async function applyMode(l: Live, input: Pick<TurnInput, "mode" | "permissionMode">) {
  const modes = l.modes;
  const askMode = input.permissionMode === "ask" ? (acpAgentInfo(l.agent).askMode ?? null) : null;
  const picked = input.mode !== null && !!modes?.options.some((o) => o.value === input.mode);
  if (askMode && !picked && !modes?.options.some((o) => o.value === askMode)) {
    throw new Error(`${acpAgentInfo(l.agent).product} no longer offers its « ${askMode} » mode, which BytNode-AI starts it in so that it asks before acting. Pick a mode in the conversation's mode menu, or update BytNode-AI.`);
  }
  const target = turnMode(modes, { requested: input.mode, askMode, restore: l.modeBeforeAsk });
  if (!modes || !target) return;
  if (askMode && target === askMode) {
    if (modes.current !== askMode && l.modeBeforeAsk === null) l.modeBeforeAsk = modes.current;
  } else l.modeBeforeAsk = null;
  if (target === modes.current) return;
  try {
    if (modes.configId) {
      const res = await l.conn.setConfig(l.sessionId, modes.configId, target);
      l.configOptions = res.configOptions ?? l.configOptions;
    } else await l.conn.setMode(l.sessionId, target);
    l.modes = { ...modes, current: target };
  } catch (e) {
    if (target === askMode && !picked) throw new Error(`Could not put ${acpAgentInfo(l.agent).product} in its « ${askMode} » mode (${e instanceof Error ? e.message : String(e)}), which BytNode-AI starts it in so that it asks before acting.`);
    /* another refused mode does not block the turn */
  }
}

/** Applies model and effort through the session options, when the agent
    publishes them; silently if nothing changes. */
async function applyConfig(l: Live, input: Pick<TurnInput, "modelId" | "effort">) {
  const modelCfg = modelConfigId(l.configOptions);
  const effortCfg = effortsOfConfig(l.configOptions);
  const current = (id: string) => {
    const o = l.configOptions.find((c) => c.id === id);
    return o && o.type === "select" ? o.currentValue : null;
  };
  const wanted = input.modelId && input.modelId !== DEFAULT_MODEL ? input.modelId : null;
  try {
    if (modelCfg && wanted && current(modelCfg) !== wanted) {
      const res = await l.conn.setConfig(l.sessionId, modelCfg, wanted);
      l.configOptions = res.configOptions ?? l.configOptions;
    } else if (!modelCfg && l.legacyModel !== null && wanted && l.legacyModel !== wanted) {
      await l.conn.setModel(l.sessionId, wanted);
      l.legacyModel = wanted;
    }
    if (effortCfg && input.effort && effortCfg.values.includes(input.effort) && effortCfg.current !== input.effort) {
      const res = await l.conn.setConfig(l.sessionId, effortCfg.configId, input.effort);
      l.configOptions = res.configOptions ?? l.configOptions;
    }
  } catch {
    /* a refused setting does not block the turn */
  }
}

/** The tools of ours that never ask (their policy does not gate them —
    the read-only ones): the native engine runs them without a prompt, so
    a subscription agent's request for one is granted without bothering
    the user either. */
async function ungatedTools(input: Pick<TurnInput, "bytnodeKey" | "exchangeAccounts" | "plugins">): Promise<Set<string>> {
  try {
    const { tools } = await allTools({ engine: "mcp", platform: process.platform, bytnodeKey: input.bytnodeKey, exchangeAccounts: input.exchangeAccounts, depth: 0, plugins: input.plugins });
    return new Set(
      tools
        .filter((t) => {
          const p = resolvePolicy(t.name, t.policy);
          return !p.gated && !p.alwaysAsk;
        })
        .map((t) => t.name),
    );
  } catch {
    return new Set();
  }
}

/** One turn. `claim`: the one the route took when the request arrived
    (so a cancel during its own preparation counts); taken here otherwise. */
export async function runTurn(input: TurnInput, emit: (e: WireEvent) => void, signal: AbortSignal, claim?: TurnClaim): Promise<void> {
  const t = claim ?? claimTurn(input.conversationId);
  if (!t) throw new Error(BUSY);
  /* FIRST, before anything slow: an abort during the opening must count. */
  const onAbort = () => cancelClaim(t);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  let l: Live | null = null;
  try {
    if (t.cancelled) {
      emit({ type: "done", finishReason: "cancelled" });
      return;
    }
    const { l: opened, fresh } = await ensureSession(input);
    l = opened;
    t.live = l;
    if (t.closed) {
      dropLive(input.conversationId, l);
      l = null;
      emit({ type: "done", finishReason: "cancelled" });
      return;
    }
    l.busy = true;
    l.lastUsed = Date.now();
    emit({ type: "session", sessionId: l.sessionId });
    if (t.cancelled) {
      /* Stopped while the session opened: the session stays for the next
         message, but this prompt never goes out. */
      emit({ type: "done", finishReason: "cancelled" });
      return;
    }
    const configured = clock();
    await applyMode(l, input);
    await applyConfig(l, input);
    trace(`${input.agent}: settings applied in ${configured()} (model ${input.modelId ?? "default"}, effort ${input.effort ?? "-"}${l.modes ? `, mode ${l.modes.current}` : ""})`);
    if (l.toolsReady) {
      const ready = l.toolsReady;
      l.toolsReady = null;
      const waited = clock();
      const ok = await waitForTools(ready, t.stopped);
      trace(`${input.agent}: bytnode-ai tools ${ok ? "ready" : "not announced"} after ${waited()}`);
    }
    const ungated = await ungatedTools(input);

    let text = input.text;
    if (input.agent !== "claude" && (input.firstTurn || fresh)) {
      const system = input.history && !input.firstTurn ? `${input.system}\n\n## Previous thread\n${input.history}` : input.system;
      text = wrapContext(system, text);
    } else if (input.agent === "claude" && fresh && !input.firstTurn && input.history) {
      text = `<previous_thread>\n${input.history}\n</previous_thread>\n\n${text}`;
    }

    const session = l;
    const answered = clock();
    let firstWord = false;
    /* The calls opened and not closed yet, and those the user refused: a
       refusal ENDS a Codex turn (read-only mode) without closing its call,
       which would stay « running » in the thread. */
    const open = new Set<string>();
    const refused = new Set<string>();
    /* What each call said of itself: a permission request may not. */
    const known = new Map<string, CallInfo>();
    session.cost.begin();
    session.conn.listen(
      session.sessionId,
      (n) => {
        if (session.loading) return;
        if (!firstWord && n.update.sessionUpdate === "agent_message_chunk") {
          firstWord = true;
          trace(`${input.agent}: first word after ${answered()}`);
        }
        const u = n.update;
        if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") known.set(u.toolCallId, mergeCallInfo(known.get(u.toolCallId), u));
        for (const e of eventsOfUpdate(u)) {
          if (e.type === "tool_call") open.add(e.id);
          else if (e.type === "tool_result") open.delete(e.id);
          if (e.type === "usage" && typeof e.usage.cost === "number") {
            const cost = session.cost.of(e.usage.cost);
            const { cost: _total, ...rest } = e.usage;
            void _total;
            emit({ type: "usage", usage: cost === null ? rest : { ...rest, cost } });
            continue;
          }
          emit(e);
        }
      },
      async (req) => {
        const id = req.toolCall.toolCallId;
        const { call, title, identified } = permissionSubject(req.toolCall, known.get(id));
        /* ⚠️ ONE PROMPT PER MONEY ACTION, AND IT IS OURS. An order, a close
           or a transfer through OUR server never runs before the user has
           confirmed it in this thread (`confirmCall`, asked by the server
           itself, whatever the agent's mode): the agent's own request for
           it would be a second prompt for the same click — granted once,
           never « always ». Anything else that looks critical (another
           server's tool, the agent's own) still asks below. */
        if (isServerConfirmedCall(call, alwaysAskTools())) {
          const once = pickPermissionOption(req.options, true, false);
          if (once) return selected(once);
        }
        /* An order, a close, a transfer — or a call nothing identifies: we
           ask even in direct execution, and never « always ». */
        const isCritical = !identified || critical(call);
        if (!isCritical) {
          if (input.permissionMode === "skip") return selected(pickPermissionOption(req.options, true, false) ?? pickPermissionOption(req.options, true, true));
          /* A read-only tool of ours: no more a question than natively. */
          if (isUngatedMcpCall(call, ungated)) {
            const once = pickPermissionOption(req.options, true, false);
            if (once) return selected(once);
          }
        }
        if (t.cancelled) return selected(null);
        const optionId = await new Promise<string | null>((resolve) => {
          session.pending.set(id, { options: req.options, resolve, critical: isCritical });
          emit({ type: "permission", id, title, options: req.options });
        });
        session.pending.delete(id);
        const kind = req.options.find((o) => o.optionId === optionId)?.kind;
        if (!optionId || kind === "reject_once" || kind === "reject_always") refused.add(id);
        return selected(optionId);
      },
    );
    t.confirm = confirmInThread({ session, emit, stopped: () => t.cancelled, calls: () => [...open].map((cid) => ({ id: cid, call: known.get(cid) })) });

    if (t.cancelled) {
      emit({ type: "done", finishReason: "cancelled" });
      return;
    }
    t.prompting = true;
    try {
      const res = await session.conn.prompt(session.sessionId, text, input.images ?? []);
      closeRefused(open, refused, emit);
      /* A turn the agent ended on the user's refusal is not an interrupted
         one: nothing to resume. */
      const reason = res.stopReason === "cancelled" && !t.cancelled && refused.size > 0 ? "end_turn" : res.stopReason;
      emit({ type: "done", finishReason: reason });
    } catch (e) {
      if (!t.cancelled) throw describe(e, session.conn);
      emit({ type: "done", finishReason: "cancelled" });
    }
  } finally {
    t.confirm = null;
    signal.removeEventListener("abort", onAbort);
    if (l) {
      l.conn.listen(l.sessionId, null, null);
      for (const p of l.pending.values()) p.resolve(null);
      l.pending.clear();
      l.busy = false;
      l.lastUsed = Date.now();
      if (!l.conn.alive) {
        if (live.get(input.conversationId) === l) live.delete(input.conversationId);
      } else if (t.cancelSent && l.agent === "claude" && l.conn.canRestartSession) l.restarting = restartSession(l);
    }
    releaseTurn(t);
  }
}

/** Closes the calls a refusal left open (see `refused` in `runTurn`). */
function closeRefused(open: Set<string>, refused: Set<string>, emit: (e: WireEvent) => void) {
  for (const id of open) {
    if (refused.has(id)) emit({ type: "tool_result", id, ok: false, output: "Refused. The agent ended its turn on this refusal: say what to do instead." });
  }
}

/** The user's answer to a permission request. */
export function answerPermission(conversationId: string, callId: string, allow: boolean, always: boolean, nonce?: string): boolean {
  const l = live.get(conversationId);
  const p = l?.pending.get(callId);
  if (!p) return false;
  /* Our own confirmation answers only to the stream that showed it: the
     agent knows the conversation and its call ids, and a « Run directly »
     agent could POST an « allow » itself. */
  if (p.nonce !== undefined && p.nonce !== nonce) return false;
  p.resolve(pickPermissionOption(p.options, allow, always && !p.critical));
  return true;
}

/* ---------------------------------------------------------------------------
   BytNode-AI's own confirmation of a money action.

   ⚠️ AN ORDER BY A SUBSCRIPTION AGENT USED TO DEPEND ON THE AGENT ASKING.
   Codex in « Run directly » lets its own reviewer approve MCP calls, a
   Claude in « bypass » asks nothing: PlaceOrder could run with no one
   having clicked. The guarantee now lives in OUR MCP server
   (`finance-server.ts` → `serveCall`): before running a tool that always
   asks, it calls `/api/acp/confirm` with its conversation's token, and we
   ask the user HERE — in the live turn's thread, like an agent's request
   (same prompt, the account's LIVE / TESTNET badge, no « Always »). No live
   turn, a Stop, 10 minutes without an answer, a bad token: refused, and
   the server does not run the tool. The agent's own request for the same
   call is granted once in `runTurn` (`isServerConfirmedCall`): one prompt.
--------------------------------------------------------------------------- */

export type { ConfirmVerdict };

const CONFIRM_TIMEOUT = 10 * 60_000;
const CONFIRM_OPTIONS: PermissionOption[] = [
  { optionId: "allow", kind: "allow_once", name: "Allow" },
  { optionId: "reject", kind: "reject_once", name: "Deny" },
];

type ConfirmDeps = {
  session: Live;
  emit: (e: WireEvent) => void;
  /** The turn was stopped. */
  stopped: () => boolean;
  /** The agent's calls still open, oldest first. */
  calls: () => Array<{ id: string; call: CallInfo | undefined }>;
};

function confirmInThread({ session, emit, stopped, calls }: ConfirmDeps): NonNullable<TurnClaim["confirm"]> {
  /* The steps already used by a confirmation: two identical orders in one
     turn are two prompts on two steps. */
  const used = new Set<string>();
  return async (tool, args, signal) => {
    if (stopped()) return { allowed: false, reason: "The turn was stopped: nothing was sent." };
    const title = `mcp__${OWN_MCP_SERVER}__${tool}`;
    const matched = matchServedCall(calls().filter(({ id }) => !used.has(id) && !session.pending.has(id)), tool, args);
    const id = matched ?? `confirm-${randomUUID()}`;
    used.add(id);
    /* The prompt shows what WILL run — the server's arguments, not what the
       agent narrated. A call we cannot find gets its own step. */
    emit(matched ? { type: "tool_update", id, args } : { type: "tool_call", id, name: title, args });
    const nonce = randomUUID();
    let why = "The user denied it: nothing was sent.";
    const optionId = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        why = `No answer from the user in ${CONFIRM_TIMEOUT / 60_000} minutes: nothing was sent.`;
        finish(null);
      }, CONFIRM_TIMEOUT);
      const onAbort = () => {
        why = "The request was interrupted: nothing was sent.";
        finish(null);
      };
      const finish = (v: string | null) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (session.pending.get(id)?.resolve === finish) session.pending.delete(id);
        resolve(v);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      session.pending.set(id, { options: CONFIRM_OPTIONS, resolve: finish, critical: true, nonce });
      emit({ type: "permission", id, title, options: CONFIRM_OPTIONS, nonce });
    });
    const allowed = optionId === "allow";
    if (!allowed && optionId === null && stopped()) why = "The turn was stopped: nothing was sent.";
    if (!matched) emit({ type: "tool_result", id, ok: allowed, output: allowed ? "Confirmed." : `Not confirmed. ${why}` });
    return allowed ? { allowed: true } : { allowed: false, reason: why };
  };
}

/** Called by `/api/acp/confirm` for a conversation's MCP server. */
export async function confirmCall(req: { conversationId: string; token: string; tool: string; args: Record<string, unknown> }, signal: AbortSignal): Promise<ConfirmVerdict> {
  if (!req.token || tokens.get(req.conversationId) !== req.token) return { allowed: false, reason: "Unknown requester: nothing was sent." };
  const t = turns.get(req.conversationId);
  if (!t?.confirm || t.cancelled || t.closed) return { allowed: false, reason: "No turn of this conversation is running in BytNode-AI, so nobody can confirm the action: nothing was sent." };
  return t.confirm(req.tool, req.args, signal);
}

/** Stop: the turn in progress, whatever its stage — opening included. */
export function cancelTurn(conversationId: string): void {
  const t = turns.get(conversationId);
  if (t) cancelClaim(t);
}

export function closeConversation(conversationId: string): void {
  const t = turns.get(conversationId);
  if (t) {
    t.closed = true;
    cancelClaim(t);
  }
  const l = live.get(conversationId);
  if (l) dropLive(conversationId, l);
}

/* ---------------------------------------------------------------------------
   A subscription sub-agent.

   The parent's MCP server (Workflow) calls the server back; we open a
   THROWAWAY session of the same agent, in the same folder, with the
   requested profession's prompt, the model the parent chose for the task,
   and its own MCP servers at depth 1. Nobody can answer its permission
   requests: they are granted — except what commits funds, refused. The
   text it produces is its report; the session is closed right away.
--------------------------------------------------------------------------- */

export type SubagentInput = {
  conversationId: string;
  token: string;
  profession: ProfessionId;
  text: string;
  /** The model id as the agent knows it, or null for the current one. */
  modelId: string | null;
  bytnodeKey: string;
  exchangeAccounts: ExchangeAccount[];
};

const SUBAGENT_TIMEOUT = 10 * 60_000;

/* The skills dropped into the folder for the sub-agents: those of the FOUR
   professions (three sub-agents of different professions run at the same
   time in the same folder — none must remove the others'), then the
   project's. The parent puts its own back at its next turn. */
async function subagentSkillSet(): Promise<SkillInfo[]> {
  const all = await Promise.all(PROFESSIONS.map((p) => loadProfession(PROJECT_ROOT, p.id)));
  return [...all.flatMap((p) => p.skills), ...(await userSkills())];
}

/* Three sub-agents start together and drop the same list into the same
   folder: one at a time, otherwise one copies what the other deletes. */
let skillsLock: Promise<void> = Promise.resolve();
const syncSubagentSkills = (workspace: string, skills: SkillInfo[]) => (skillsLock = skillsLock.then(() => syncSkills(workspace, skills)).catch(() => {}));

export async function runSubagent(input: SubagentInput, signal: AbortSignal): Promise<string> {
  const parent = live.get(input.conversationId);
  if (!parent || tokens.get(input.conversationId) !== input.token) throw new Error("Unknown requester.");
  if (!parent.busy) throw new Error("The requester's turn is over.");
  const { agent, cwd: workspace } = parent;

  const runtime = activeRuntime();
  const needs = { "exchange-account": input.exchangeAccounts.length > 0, "bytnode-key": Boolean(input.bytnodeKey.trim()) };
  const [prof, skillSet, project, bytnode, plugged] = await Promise.all([
    loadProfession(PROJECT_ROOT, input.profession),
    subagentSkillSet(),
    userSkills(),
    bytnodeStatus(input.bytnodeKey),
    runtime ? pluginPrompt(runtime, parent.plugins, { agentId: parent.agentId, engine: "mcp", subagent: true }, needs) : "",
  ]);
  await syncSubagentSkills(workspace, skillSet);
  const system = [
    subagentFrame(input.profession, prof.prompt, workspace),
    buildAcpPrompt(workspace, [...prof.skills, ...project], bytnode, acpAgentInfo(agent).product, input.exchangeAccounts, 0, true),
    plugged,
  ]
    .filter(Boolean)
    .join("\n\n");
  return throwawayTurn(
    {
      agent,
      workspace,
      system,
      text: input.text,
      modelId: input.modelId,
      effort: parent.effort,
      served: { workspace, bytnodeKey: input.bytnodeKey, exchangeAccounts: input.exchangeAccounts, plugins: parent.plugins, agentId: parent.agentId },
      label: `sub-agent ${input.profession}`,
      origin: parent.origin,
    },
    signal,
  );
}

/* ---------------------------------------------------------------------------
   A subscription agent in the background (a scheduled task): the same throwaway session as a sub-agent — depth-1 tools,
   permissions granted except what commits funds — for an agent of the
   user's, with the system prompt the caller built.
--------------------------------------------------------------------------- */

export type BackgroundInput = {
  agent: AcpAgentId;
  agentId: string;
  workspace: string;
  system: string;
  text: string;
  modelId: string | null;
  effort: string | null;
  bytnodeKey: string;
  exchangeAccounts: ExchangeAccount[];
  plugins: string[] | null;
};

export async function runBackground(input: BackgroundInput, signal: AbortSignal): Promise<string> {
  await syncSubagentSkills(input.workspace, await subagentSkillSet());
  return throwawayTurn(
    {
      ...input,
      served: { workspace: input.workspace, bytnodeKey: input.bytnodeKey, exchangeAccounts: input.exchangeAccounts, plugins: input.plugins, agentId: input.agentId },
      label: "background run",
    },
    signal,
  );
}

/** Whether BytNode answers with this key, for the prompt's data-source line. */
export const bytnodeStatus = (key: string) =>
  key.trim()
    ? bytnodeTools(key).then(
        (infos) => ({ ok: true, count: infos.length }),
        (e: unknown) => ({ ok: false, count: 0, message: e instanceof Error ? e.message : String(e) }),
      )
    : Promise.resolve({ ok: false, count: 0, message: "no key" });

type Throwaway = {
  agent: AcpAgentId;
  workspace: string;
  system: string;
  text: string;
  modelId: string | null;
  effort: string | null;
  served: Served;
  label: string;
  /** The Next server's origin, when known: an agent that starts its MCP
      servers late then waits for our tools (`LATE_MCP`). */
  origin?: string;
};

/** One prompt in a session opened for it and closed after: nobody answers
    its permission requests — granted, except what commits funds. The text
    it produces is the result. */
async function throwawayTurn(t: Throwaway, signal: AbortSignal): Promise<string> {
  const readyId = t.origin && LATE_MCP.has(t.agent) ? randomUUID() : null;
  const servers = mcpServersFor(t.served, { depth: 1, ...(readyId && t.origin ? { ready: { origin: t.origin, id: readyId } } : {}) });
  const config = { system: t.system, modelId: t.modelId, effort: t.effort, mode: null };
  await prepareWorkspace(t.agent, t.workspace);
  const opened = clock();
  const conn = await AcpConnection.open(t.agent, t.workspace);
  const ready = readyId ? expectTools(readyId) : null;
  try {
    const meta = sessionMeta(t.agent, config);
    const res = await conn.newSession(t.workspace, servers, meta);
    trace(`${t.agent}: ${t.label} opened in ${opened()} (model ${t.modelId ?? "current"})`);
    const l: Live = {
      agent: t.agent,
      agentId: t.served.agentId,
      plugins: t.served.plugins,
      conn,
      sessionId: res.sessionId,
      cwd: t.workspace,
      configOptions: res.configOptions ?? [],
      legacyModel: legacyModelOf(res),
      modes: modesOfSession(res as Parameters<typeof modesOfSession>[0]),
      effort: t.effort,
      serversKey: "",
      servers,
      meta,
      system: t.system,
      lastUsed: Date.now(),
      busy: true,
      pending: new Map(),
      loading: false,
      cost: new TurnCost(),
      modeBeforeAsk: null,
      restarting: null,
      origin: t.origin ?? "",
      toolsReady: null,
    };
    await applyConfig(l, config);
    if (ready) {
      const stop = new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
      if (!(await waitForTools(ready, stop))) trace(`${t.agent}: ${t.label}: bytnode-ai tools not announced in time`);
    }

    const chunks: string[] = [];
    const known = new Map<string, CallInfo>();
    conn.listen(
      l.sessionId,
      (n) => {
        const u = n.update;
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") chunks.push(u.content.text);
        else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") known.set(u.toolCallId, mergeCallInfo(known.get(u.toolCallId), u));
      },
      async (req) => {
        /* Nobody to answer: yes, except to commit funds. A throwaway
           session dies with the turn, so an « always » grants nothing
           more than a « once » here. (Its MCP server serves no tool that
           commits funds: depth 1.) */
        if (critical(permissionSubject(req.toolCall, known.get(req.toolCall.toolCallId)).call)) return selected(null);
        return selected(pickPermissionOption(req.options, true, false) ?? pickPermissionOption(req.options, true, true));
      },
    );
    let timedOut = false;
    const cancel = () => void conn.cancel(l.sessionId).catch(() => {});
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, SUBAGENT_TIMEOUT);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await conn.prompt(l.sessionId, t.agent === "claude" ? t.text : wrapContext(t.system, t.text));
    } catch (e) {
      if (!signal.aborted && !timedOut) throw describe(e, conn);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      conn.listen(l.sessionId, null, null);
    }
    if (signal.aborted) throw new Error("Interrupted.");
    if (timedOut) throw new Error(`Timed out (${SUBAGENT_TIMEOUT / 60_000} min).`);
    return chunks.join("").trim();
  } finally {
    if (readyId) toolsWaiters.delete(readyId);
    conn.close();
  }
}
