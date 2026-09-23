import type { McpServer, PermissionOption, SessionConfigOption } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BYTNODE_MCP_URL, bytnodeTools } from "@/lib/mcp/bytnode";
import { dataDir } from "@/lib/server/data-dir";
import { PROJECT_ROOT } from "@/lib/server/workspace";
import { loadProfession } from "@/lib/professions/load";
import { PROFESSIONS, type ProfessionId } from "@/lib/professions/catalog";
import { subagentFrame } from "@/lib/tools/agents/subagent";
import { userSkills, type SkillInfo } from "@/lib/tools/skills/skill";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { AcpConnection } from "./connection";
import { prepareWorkspace } from "./prepare";
import { buildAcpPrompt, wrapContext } from "./prompt";
import { syncSkills } from "./skills-sync";
import { DEFAULT_MODEL, effortsOfConfig, eventsOfUpdate, modelConfigId, modesOfSession, pickPermissionOption, type AgentModes } from "./translate";

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
import { isAlwaysAskTitle } from "@/lib/tools/names";
import { activeRuntime } from "@/lib/plugins/core/active";
export type { WireEvent };

/** A call that commits funds, or whose tool always asks by its policy:
    it is never answered « always », never auto-allowed. */
const critical = (title: string) => isAlwaysAskTitle(title, activeRuntime()?.alwaysAskTools() ?? []);

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
  /** The call's title: a tool that commits funds does not accept « always ». */
  title: string;
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
  /** The system prompt set at creation: if it changes (profession,
      context, skills), the session is recreated, otherwise the agent
      would carry on with the old profession. */
  system: string;
  lastUsed: number;
  busy: boolean;
  pending: Map<string, Pending>;
  /** True during `session/load`: the replayed updates are ignored. */
  loading: boolean;
};

const IDLE_TTL = 15 * 60_000;
const live = new Map<string, Live>();

let reaper: NodeJS.Timeout | null = null;
function armReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, l] of live) {
      if (!l.busy && now - l.lastUsed > IDLE_TTL) {
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
   BytNode-AI's finance tools (SaveMarketData, Chart, Backtest, Memory),
   served by a small stdio process in the workspace. */
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
  return String(Math.floor(latest));
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

/** The MCP server of a main agent (depth 0, with Workflow and what it
    takes to call the server back) or of a sub-agent (depth 1: neither
    Workflow nor any tool that commits funds). */
type Depth = { depth: 0; conversationId: string; agent: AcpAgentId; origin: string } | { depth: 1 };

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
        ]
      : [];
  const servers: McpServer[] = [
    {
      name: "bytnode-ai",
      command: process.execPath,
      args: [
        path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
        /* The project's tsconfig, explicitly: the agent launches this
           server in the workspace, and the `@/` aliases must resolve from
           the project — not from where the process starts. */
        "--tsconfig",
        path.join(PROJECT_ROOT, "tsconfig.json"),
        path.join(PROJECT_ROOT, "lib", "mcp", "finance-server.ts"),
      ],
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
    return { l: current, fresh: false, loaded: false };
  }
  if (current) {
    current.conn.close();
    live.delete(input.conversationId);
  }
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
    system: input.system,
    lastUsed: Date.now(),
    busy: false,
    pending: new Map(),
    loading: false,
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
  live.set(input.conversationId, l);
  armReaper();
  return { l, fresh: !loaded, loaded };
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

/** Applies model and effort through the session options, when the agent
    publishes them; silently if nothing changes. */
async function applyConfig(l: Live, input: Pick<TurnInput, "modelId" | "effort" | "mode">) {
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
    /* The mode: through the config option when the agent has one,
       otherwise through `session/set_mode`. */
    const modes = l.modes;
    if (modes && input.mode && input.mode !== modes.current && modes.options.some((o) => o.value === input.mode)) {
      if (modes.configId) {
        const res = await l.conn.setConfig(l.sessionId, modes.configId, input.mode);
        l.configOptions = res.configOptions ?? l.configOptions;
      } else await l.conn.setMode(l.sessionId, input.mode);
      l.modes = { ...modes, current: input.mode };
    }
  } catch {
    /* a refused setting does not block the turn */
  }
}

export async function runTurn(input: TurnInput, emit: (e: WireEvent) => void, signal: AbortSignal): Promise<void> {
  const { l, fresh } = await ensureSession(input);
  if (l.busy) throw new Error("This conversation already has a turn in progress.");
  l.busy = true;
  l.lastUsed = Date.now();
  emit({ type: "session", sessionId: l.sessionId });
  const configured = clock();
  await applyConfig(l, input);
  trace(`${input.agent}: settings applied in ${configured()} (model ${input.modelId ?? "default"}, effort ${input.effort ?? "-"})`);

  let text = input.text;
  if (input.agent !== "claude" && (input.firstTurn || fresh)) {
    const system = input.history && !input.firstTurn ? `${input.system}\n\n## Previous thread\n${input.history}` : input.system;
    text = wrapContext(system, text);
  } else if (input.agent === "claude" && fresh && !input.firstTurn && input.history) {
    text = `<previous_thread>\n${input.history}\n</previous_thread>\n\n${text}`;
  }

  const onAbort = () => {
    void l.conn.cancel(l.sessionId).catch(() => {});
    for (const p of l.pending.values()) p.resolve(null);
    l.pending.clear();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const answered = clock();
  let firstWord = false;
  l.conn.listen(
    l.sessionId,
    (n) => {
      if (l.loading) return;
      if (!firstWord && n.update.sessionUpdate === "agent_message_chunk") {
        firstWord = true;
        trace(`${input.agent}: first word after ${answered()}`);
      }
      for (const e of eventsOfUpdate(n.update)) emit(e);
    },
    async (req) => {
      /* An order, a close, a transfer: we ask even in direct execution. */
      const auto = input.permissionMode === "skip" && !critical(req.toolCall.title ?? "");
      const id = req.toolCall.toolCallId;
      if (auto) {
        const optionId = pickPermissionOption(req.options, true, false);
        return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
      }
      const optionId = await new Promise<string | null>((resolve) => {
        l.pending.set(id, { options: req.options, resolve, title: req.toolCall.title ?? "" });
        emit({ type: "permission", id, title: req.toolCall.title ?? "", options: req.options });
      });
      l.pending.delete(id);
      return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    },
  );

  try {
    const res = await l.conn.prompt(l.sessionId, text, input.images ?? []);
    emit({ type: "done", finishReason: res.stopReason });
  } catch (e) {
    if (!signal.aborted) throw describe(e, l.conn);
    emit({ type: "done", finishReason: "cancelled" });
  } finally {
    signal.removeEventListener("abort", onAbort);
    l.conn.listen(l.sessionId, null, null);
    l.busy = false;
    l.lastUsed = Date.now();
    if (!l.conn.alive) live.delete(input.conversationId);
  }
}

/** The user's answer to a permission request. */
export function answerPermission(conversationId: string, callId: string, allow: boolean, always: boolean): boolean {
  const l = live.get(conversationId);
  const p = l?.pending.get(callId);
  if (!p) return false;
  p.resolve(pickPermissionOption(p.options, allow, always && !critical(p.title)));
  return true;
}

export function cancelTurn(conversationId: string): void {
  const l = live.get(conversationId);
  if (!l) return;
  void l.conn.cancel(l.sessionId).catch(() => {});
  for (const p of l.pending.values()) p.resolve(null);
  l.pending.clear();
}

export function closeConversation(conversationId: string): void {
  const l = live.get(conversationId);
  if (!l) return;
  l.conn.close();
  live.delete(conversationId);
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

  const [prof, skillSet, project, bytnode] = await Promise.all([
    loadProfession(PROJECT_ROOT, input.profession),
    subagentSkillSet(),
    userSkills(),
    input.bytnodeKey.trim()
      ? bytnodeTools(input.bytnodeKey).then(
          (infos) => ({ ok: true, count: infos.length }),
          (e: unknown) => ({ ok: false, count: 0, message: e instanceof Error ? e.message : String(e) }),
        )
      : Promise.resolve({ ok: false, count: 0, message: "no key" }),
  ]);
  await syncSubagentSkills(workspace, skillSet);
  const system = [
    subagentFrame(input.profession, prof.prompt, workspace),
    buildAcpPrompt(workspace, [...prof.skills, ...project], bytnode, acpAgentInfo(agent).product, input.exchangeAccounts, 0, true),
  ].join("\n\n");
  const servers = mcpServersFor({ workspace, bytnodeKey: input.bytnodeKey, exchangeAccounts: input.exchangeAccounts, plugins: parent.plugins, agentId: parent.agentId }, { depth: 1 });
  const config = { system, modelId: input.modelId, effort: parent.effort, mode: null };

  await prepareWorkspace(agent, workspace);
  const opened = clock();
  const conn = await AcpConnection.open(agent, workspace);
  try {
    const res = await conn.newSession(workspace, servers, sessionMeta(agent, config));
    trace(`${agent}: sub-agent ${input.profession} opened in ${opened()} (model ${input.modelId ?? "current"})`);
    const l: Live = {
      agent,
      agentId: parent.agentId,
      plugins: parent.plugins,
      conn,
      sessionId: res.sessionId,
      cwd: workspace,
      configOptions: res.configOptions ?? [],
      legacyModel: legacyModelOf(res),
      modes: modesOfSession(res as Parameters<typeof modesOfSession>[0]),
      effort: parent.effort,
      serversKey: "",
      system,
      lastUsed: Date.now(),
      busy: true,
      pending: new Map(),
      loading: false,
    };
    await applyConfig(l, config);

    const chunks: string[] = [];
    conn.listen(
      l.sessionId,
      (n) => {
        if (n.update.sessionUpdate === "agent_message_chunk" && n.update.content.type === "text") chunks.push(n.update.content.text);
      },
      async (req) => {
        /* Nobody to answer: yes, except to commit funds. */
        if (critical(req.toolCall.title ?? "")) return { outcome: { outcome: "cancelled" } };
        const optionId = pickPermissionOption(req.options, true, false);
        return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
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
      await conn.prompt(l.sessionId, agent === "claude" ? input.text : wrapContext(system, input.text));
    } catch (e) {
      if (!signal.aborted && !timedOut) throw describe(e, conn);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      conn.listen(l.sessionId, null, null);
    }
    if (signal.aborted) throw new Error("Sub-agent interrupted.");
    if (timedOut) throw new Error(`Timed out (${SUBAGENT_TIMEOUT / 60_000} min).`);
    return chunks.join("").trim();
  } finally {
    conn.close();
  }
}
