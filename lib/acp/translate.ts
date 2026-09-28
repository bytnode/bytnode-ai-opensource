import type {
  PermissionOption,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionUpdate,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type { Model } from "@/lib/domain/types";
import { ACP_PREFIX, type AcpAgentId } from "./agents";
import type { PlanEntry, UsageInfo } from "@/lib/agent/events";
import { CARD_URI, type WireEvent } from "./wire";
import { agentCommands } from "./commands";
import type { ToolCard } from "@/lib/tools/types";

/* ---------------------------------------------------------------------------
   Translate what an ACP agent narrates into BytNode-AI's vocabulary.

   The external agent sends `session/update`s: text chunks, tool calls with
   their state, plans, mode changes. BytNode-AI's thread only knows
   `AgentEvent`s (text, call, result): we keep only what projects onto
   them. Nothing here touches the network or the process — which is what
   makes these rules testable.
--------------------------------------------------------------------------- */

const KIND_LABELS: Record<ToolKind, string> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  execute: "Command",
  think: "Thinking",
  fetch: "Web",
  switch_mode: "Mode",
  other: "Tool",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The tool's name: the one the agent declares, else the one Claude Code
    slips into the metadata, else the category. */
function toolName(update: Pick<ToolCallUpdate, "name" | "kind" | "_meta" | "rawInput">): string | null {
  const mcp = mcpInvocation(update.rawInput);
  if (mcp) return `mcp__${mcp.server}__${mcp.tool}`;
  const meta = update._meta?.claudeCode;
  const fromMeta = isRecord(meta) && typeof meta.toolName === "string" ? meta.toolName : null;
  return update.name?.trim() || fromMeta || (update.kind ? KIND_LABELS[update.kind] : null);
}

const argsOf = (update: Pick<ToolCallUpdate, "rawInput" | "title">): Record<string, unknown> | null => {
  const mcp = mcpInvocation(update.rawInput);
  if (mcp) return mcp.arguments;
  if (isRecord(update.rawInput) && Object.keys(update.rawInput).length > 0) return update.rawInput;
  return update.title ? { title: update.title } : null;
};

/* ⚠️ CODEX NAMES EVERY MCP CALL « Command ». Its code mode reports a call
   to one of our tools as an `execute` call whose raw input is the
   invocation `{ server, tool, arguments }`: the step was named `Command`
   and its arguments were the envelope, so no card, no Workflow view, no
   badge ever matched. We rename it the way Claude Code names it
   (`mcp__<server>__<tool>`) and keep only the tool's own arguments. */
type McpInvocation = { server: string; tool: string; arguments: Record<string, unknown> };
function mcpInvocation(raw: unknown): McpInvocation | null {
  if (!isRecord(raw) || typeof raw.server !== "string" || typeof raw.tool !== "string" || !raw.server || !raw.tool) return null;
  if (raw.arguments !== undefined && raw.arguments !== null && !isRecord(raw.arguments)) return null;
  return { server: raw.server, tool: raw.tool, arguments: isRecord(raw.arguments) ? raw.arguments : {} };
}

const MCP_NAME = /^mcp__(.+?)__([A-Za-z0-9_-]+)$/;

/** The MCP tool behind a call or a permission request, whatever the agent's
    way of saying it: Codex's invocation `{ server, tool }`, Claude Code's
    `mcp__<server>__<tool>` (as the title, the name or in its metadata).
    Null for the agent's own tools. */
export function mcpToolOf(call: Pick<ToolCallUpdate, "rawInput" | "title" | "_meta"> & { name?: string | null }): { server: string; tool: string } | null {
  const inv = mcpInvocation(call.rawInput);
  if (inv) return { server: inv.server, tool: inv.tool };
  const meta = call._meta?.claudeCode;
  const fromMeta = isRecord(meta) && typeof meta.toolName === "string" ? meta.toolName : null;
  for (const n of [call.name, fromMeta, call.title]) {
    const m = typeof n === "string" ? MCP_NAME.exec(n.trim()) : null;
    if (m) return { server: m[1], tool: m[2] };
  }
  return null;
}

/** What we know of a call from its `tool_call` / `tool_call_update`s. */
export type CallInfo = Pick<ToolCallUpdate, "title" | "rawInput" | "_meta">;

export function mergeCallInfo(prev: CallInfo | undefined, update: CallInfo): CallInfo {
  return {
    title: update.title?.trim() ? update.title : (prev?.title ?? null),
    rawInput: update.rawInput ?? prev?.rawInput,
    _meta: update._meta ?? prev?._meta,
  };
}

/** What a permission request is about, and the title to show.
    ⚠️ CODEX ASKS WITH AN EMPTY TITLE AND NO RAW INPUT for an MCP call —
    only the call's id: the prompt showed a blank question, no tool was
    recognised (a read-only one was not let through, and an ORDER would
    have been offered « always »). We complete the request with what the
    call itself said. `identified` false: nothing tells what it is — the
    caller treats it like an order. */
export function permissionSubject(req: CallInfo, known: CallInfo | undefined): { call: CallInfo; title: string; identified: boolean } {
  const call = known ? mergeCallInfo(known, req) : req;
  const mcp = mcpToolOf(call);
  const title = req.title?.trim() || (mcp ? `mcp__${mcp.server}__${mcp.tool}` : (call.title?.trim() ?? ""));
  return { call, title, identified: Boolean(title) || mcp !== null };
}

/** A permission request the user need not see: a call to a tool of ours
    whose policy does not gate it (a read-only tool — the native engine
    never asks for one either), or to BytNode's data server, read-only by
    design. The caller checks the ALWAYS_ASK floor first: this never
    decides for an order. */
export function isUngatedMcpCall(call: Parameters<typeof mcpToolOf>[0], ungatedTools: ReadonlySet<string>): boolean {
  const mcp = mcpToolOf(call);
  if (!mcp) return false;
  if (mcp.server === "bytnode") return true;
  return mcp.server === OWN_MCP_SERVER && ungatedTools.has(mcp.tool);
}

/** The name `sessions.ts` gives our own MCP server (`finance-server.ts`). */
export const OWN_MCP_SERVER = "bytnode-ai";

/** A call to one of OUR tools that always asks (an order, a close, a
    transfer): our MCP server asks the user itself before running it
    (`confirmCall` in `sessions.ts`), whatever the agent's mode — so the
    agent's own permission request for it is granted once, and the user
    sees ONE prompt, ours. Never true for anything else: another server's
    tool, or the agent's own, is not guarded by our server. */
export function isServerConfirmedCall(call: Parameters<typeof mcpToolOf>[0], alwaysAsk: Iterable<string>): boolean {
  const mcp = mcpToolOf(call);
  return mcp !== null && mcp.server === OWN_MCP_SERVER && new Set(alwaysAsk).has(mcp.tool);
}

/** The arguments a call carries (Codex's invocation or the raw input). */
const callArgs = (call: CallInfo | undefined): Record<string, unknown> | null => {
  if (!call) return null;
  const inv = mcpInvocation(call.rawInput);
  if (inv) return inv.arguments;
  return isRecord(call.rawInput) ? call.rawInput : null;
};

/** Key order does not make two argument sets different. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : isRecord(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v) ?? "null";

/** Which of the agent's open calls our server is running `tool(args)`
    for: the latest call to that tool of ours with the same arguments,
    else the latest call to that tool, else null. The confirmation is then
    asked ON that step of the thread (one row, its badge), not on a new one. */
export function matchServedCall(calls: Array<{ id: string; call: CallInfo | undefined }>, tool: string, args: Record<string, unknown>): string | null {
  const same = [...calls].reverse().filter(({ call }) => {
    const mcp = call ? mcpToolOf(call) : null;
    return mcp?.server === OWN_MCP_SERVER && mcp.tool === tool;
  });
  const wanted = stable(args);
  return (same.find(({ call }) => stable(callArgs(call)) === wanted) ?? same[0])?.id ?? null;
}

export function eventsOfUpdate(update: SessionUpdate): WireEvent[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text" ? [{ type: "text", text: update.content.text }] : [];
    /* ⚠️ THE REASONING STAYS ON THE PROVIDER'S SIDE. Codex sends its
       reasoning summary here AND as a `kind: "think"` tool call below, so
       a « bonjour » showed a folded « Reasoning » block plus a « Thinking »
       step for the same two sentences. Neither is shown any more. */
    case "agent_thought_chunk":
      return [];
    case "plan":
    case "plan_update": {
      const entries = (update as { entries?: Array<{ content?: string; status?: string }> }).entries ?? [];
      const plan: PlanEntry[] = entries
        .filter((e) => typeof e.content === "string" && e.content.trim())
        .map((e) => ({
          content: e.content as string,
          status: e.status === "completed" ? "completed" : e.status === "in_progress" ? "in_progress" : "pending",
        }));
      return plan.length ? [{ type: "plan", entries: plan }] : [];
    }
    /* The agent's commands changed (skills reloaded, a plugin installed):
       the composer's list follows. */
    case "available_commands_update":
      return [{ type: "commands", commands: agentCommands(update.availableCommands) }];
    /* The agent changed its mode by itself (Claude leaving its plan mode
       once the plan is accepted): the mode picker follows. */
    case "current_mode_update":
      return [{ type: "agent_config", mode: update.currentModeId }];
    case "usage_update": {
      const u = update as { used?: number; size?: number; cost?: { amount?: number } };
      const usage: UsageInfo = {};
      /* ⚠️ A local command (`/usage`, `/model`) reports `used: 0`: no
         session is ever empty — it would drop the context meter to zero. */
      if (typeof u.used === "number" && u.used > 0) usage.context = u.used;
      if (typeof u.size === "number") usage.window = u.size;
      if (typeof u.cost?.amount === "number") usage.cost = u.cost.amount;
      return Object.keys(usage).length ? [{ type: "usage", usage }] : [];
    }
    case "tool_call": {
      /* A « think » call is reasoning dressed as a tool (Codex): dropped
         with the thought chunks. Its later `tool_call_update` then finds
         no step and is ignored by the thread. */
      if (update.kind === "think") return [];
      const name = toolName(update) ?? KIND_LABELS.other;
      const events: WireEvent[] = [{ type: "tool_call", id: update.toolCallId, name, args: argsOf(update) ?? {} }];
      /* A call already finished at birth (replayed by `session/load`). */
      if (update.status === "completed" || update.status === "failed") {
        events.push({ type: "tool_result", id: update.toolCallId, ok: update.status === "completed", output: toolOutputOf(update) });
      }
      return events;
    }
    case "tool_call_update": {
      if (update.status === "completed" || update.status === "failed") {
        const images = imagesOf(update);
        const card = cardOf(update);
        return [{ type: "tool_result", id: update.toolCallId, ok: update.status === "completed", output: toolOutputOf(update), ...(images.length ? { images } : {}), ...(card ? { card } : {}) }];
      }
      /* In progress: the agent refines the name, the arguments, sometimes
         a partial output (Claude Code sends the arguments in a second
         step). */
      const name = toolName(update);
      const args = argsOf(update);
      const partial = (update.content ?? []).map(contentText).filter(Boolean).join("\n");
      if (!name && !args && !partial) return [];
      return [{ type: "tool_update", id: update.toolCallId, ...(name ? { name } : {}), ...(args ? { args } : {}), ...(partial ? { line: partial } : {}) }];
    }
    default:
      return [];
  }
}

/** The images of a result (a chart rendered by our MCP tools), as data
    URLs for the thread — bounded, the thread lives in localStorage. */
const MAX_IMAGE_DATA = 400_000;
export function imagesOf(update: Pick<ToolCallUpdate, "content" | "rawOutput">): Array<{ name: string; src: string }> {
  const out: Array<{ name: string; src: string }> = [];
  const push = (mime: string, data: string) => {
    if (data.length <= MAX_IMAGE_DATA) out.push({ name: `image ${out.length + 1}`, src: `data:${mime};base64,${data}` });
  };
  for (const c of update.content ?? []) {
    if (c.type === "content" && c.content.type === "image") push(c.content.mimeType, c.content.data);
  }
  if (out.length === 0 && Array.isArray(update.rawOutput)) {
    for (const b of update.rawOutput as Array<{ type?: string; data?: string; mimeType?: string }>) {
      if (b?.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string") push(b.mimeType, b.data);
    }
  }
  return out;
}

/** A plugin's card, carried as a resource by our MCP server's result
    (`CARD_URI`): in the call's contents, or in its raw output depending on
    the agent. */
export function cardOf(update: Pick<ToolCallUpdate, "content" | "rawOutput">): ToolCard | undefined {
  const blocks: unknown[] = [
    ...(update.content ?? []).map((c) => (c.type === "content" ? c.content : null)),
    ...rawBlocks(update.rawOutput),
    ...(typeof update.rawOutput === "string" ? [{ type: "text", text: update.rawOutput }] : []),
  ];
  for (const b of blocks) {
    const card = isRecord(b) && b.type === "resource" ? cardOfResource(b.resource) : isRecord(b) && b.type === "text" && typeof b.text === "string" ? cardInText(b.text) : undefined;
    if (card) return card;
  }
  return undefined;
}

/** The MCP content blocks inside a raw output, in the three shapes seen:
    the blocks themselves, `{ content }`, and Codex's envelope
    `{ result: { content }, error }`. */
function rawBlocks(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw.content)) return raw.content;
  if (isRecord(raw.result) && Array.isArray(raw.result.content)) return raw.result.content;
  return [];
}

const parseCard = (text: string): ToolCard | undefined => {
  try {
    const card = JSON.parse(text) as unknown;
    if (isRecord(card) && typeof card.kind === "string" && isRecord(card.data)) return { kind: card.kind, data: card.data };
  } catch {
    /* not ours after all */
  }
  return undefined;
};

const cardOfResource = (resource: unknown): ToolCard | undefined =>
  isRecord(resource) && resource.uri === CARD_URI && typeof resource.text === "string" ? parseCard(resource.text) : undefined;

/** The card, when the agent turned our resource block into text: Claude
    Code's adapter writes an unknown block as its JSON (`{"type":"resource",
    …}`), and the MCP server also adds a `bytnode-ai://card {…}` line as a
    fallback (`lib/mcp/finance-server.ts`). */
function cardInText(text: string): ToolCard | undefined {
  if (!text.includes(CARD_URI)) return undefined;
  try {
    const block = JSON.parse(text) as unknown;
    if (isRecord(block) && block.type === "resource") return cardOfResource(block.resource);
  } catch {
    /* not a whole block: the marker line */
  }
  for (const line of text.split("\n")) {
    const card = cardOfLine(line);
    if (card) return card;
  }
  return undefined;
}

/* ⚠️ CLAUDE CODE HAS A THIRD WAY OF WRITING OUR RESOURCE: the current binary
   renders it as `[Resource from bytnode-ai at bytnode-ai://card] {…}` —
   neither the whole-block JSON nor our marker line. The card was still
   found (on the marker line), but that line stayed in the detail pane and
   in the stored conversation. */
const RENDERED_RESOURCE = /^\[Resource from .* at bytnode-ai:\/\/card\] (\{.*\})\s*$/;

/** The card carried by one line: our marker line, or Claude Code's
    rendering of the resource. */
function cardOfLine(line: string): ToolCard | undefined {
  if (line.startsWith(`${CARD_URI} `)) return parseCard(line.slice(CARD_URI.length + 1));
  const rendered = RENDERED_RESOURCE.exec(line);
  return rendered ? parseCard(rendered[1]) : undefined;
}

/** A text without what only carries the card: a whole resource block
    turned into JSON disappears, a carrier line is removed from the rest. */
function withoutCarriers(text: string): string {
  if (!text.includes(CARD_URI)) return text;
  try {
    const block = JSON.parse(text) as unknown;
    if (isRecord(block) && block.type === "resource" && cardOfResource(block.resource)) return "";
  } catch {
    /* not a whole block */
  }
  return text
    .split("\n")
    .filter((line) => !cardOfLine(line))
    .join("\n");
}

/** What we show as a call's output: its text contents, a diff summarised
    by its path and its new text, otherwise the raw output. */
export function toolOutputOf(update: Pick<ToolCallUpdate, "toolCallId" | "content" | "rawOutput" | "status">): string {
  /* A failure: the raw error first, the diff that was not applied teaches
     nothing. */
  if (update.status === "failed" && typeof update.rawOutput === "string" && update.rawOutput.trim()) return update.rawOutput;
  const parts: string[] = [];
  for (const c of update.content ?? []) parts.push(withoutCarriers(contentText(c)));
  const text = parts.filter(Boolean).join("\n").trim();
  if (text) return text;
  const raw = update.rawOutput;
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return withoutCarriers(raw).trim();
  /* Codex's envelope `{ result: { content }, error }`: the tool's text,
     or its error — not the JSON of the whole envelope (the card twice). */
  if (isRecord(raw) && "result" in raw) {
    if (typeof raw.error === "string" && raw.error.trim()) return raw.error;
    if (isRecord(raw.error) && typeof raw.error.message === "string") return raw.error.message;
    const texts = rawBlocks(raw)
      .map((b) => (isRecord(b) && b.type === "text" && typeof b.text === "string" ? withoutCarriers(b.text) : ""))
      .filter(Boolean);
    if (texts.length) return texts.join("\n").trim();
  }
  return JSON.stringify(raw);
}

function contentText(c: ToolCallContent): string {
  switch (c.type) {
    case "content":
      return c.content.type === "text" ? c.content.text : `[${c.content.type}]`;
    case "diff":
      return `${c.path}\n${c.newText}`;
    case "terminal":
      return `[terminal ${c.terminalId}]`;
    default:
      return "";
  }
}

/* --- Models and efforts, from the session options ------------------------ */

const flatOptions = (opts: SessionConfigOption & { type: "select" }): SessionConfigSelectOption[] =>
  opts.options.flatMap((o) => ("group" in o ? o.options : [o]));

const selectOf = (options: SessionConfigOption[], category: string) =>
  options.find((o): o is SessionConfigOption & { type: "select" } => o.type === "select" && o.category === category) ?? null;

/** The model id of an agent that publishes none: we leave it to its own
    setting, and do not try to change it. */
export const DEFAULT_MODEL = "default";

/** What a session says about its models, in its two forms: the config
    options (category `model`, the current form) or the old `models` field
    (Gemini CLI). */
export type SessionModels = {
  configOptions?: SessionConfigOption[] | null;
  models?: { availableModels: { modelId: string; name: string; description?: string | null }[]; currentModelId: string } | null;
  modes?: { availableModes: { id: string; name: string; description?: string | null }[]; currentModeId: string } | null;
};

/** A session's modes: the way the external agent behaves (« Default »,
    « Plan », « Accept edits »…). Two forms: a config option of category
    `mode` (Claude Code, Copilot) or the old `modes` field (Gemini CLI).
    `configId` says which way to change it. */
export type AgentModes = { configId: string | null; current: string; options: Array<{ value: string; name: string; description?: string | null }> };

export function modesOfSession(session: SessionModels): AgentModes | null {
  const select = selectOf(session.configOptions ?? [], "mode");
  if (select) {
    return { configId: select.id, current: select.currentValue, options: flatOptions(select).map((o) => ({ value: o.value, name: o.name, description: o.description ?? null })) };
  }
  if (session.modes) {
    return {
      configId: null,
      current: session.modes.currentModeId,
      options: session.modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description ?? null })),
    };
  }
  return null;
}

/** The models the agent offers, in its order (the first counts as the
    newest: it is the one the agent puts forward). With no model published
    at all, a single one: « Default ». */
export function modelsOfSession(agent: AcpAgentId, session: SessionModels, staticEfforts: string[]): Model[] {
  const options = session.configOptions ?? [];
  const effort = effortsOfConfig(options);
  const efforts = effort ? effort.values : staticEfforts;
  const select = selectOf(options, "model");
  const list: { value: string; name: string }[] = select
    ? flatOptions(select)
    : session.models
      ? session.models.availableModels.map((m) => ({ value: m.modelId, name: m.name }))
      : [{ value: DEFAULT_MODEL, name: "Default" }];
  const base = Math.floor(Date.now() / 1000);
  return list.map((o, i) => ({
    id: `${ACP_PREFIX}${agent}/${o.value}`,
    name: o.name,
    providerId: `${ACP_PREFIX}${agent}`,
    created: base - i,
    contextLength: null,
    variant: null,
    alias: false,
    efforts,
    defaultEffort: effort?.current ?? null,
    reasoningMandatory: true,
  }));
}

export const modelsOfConfig = (agent: AcpAgentId, options: SessionConfigOption[], staticEfforts: string[]) =>
  modelsOfSession(agent, { configOptions: options }, staticEfforts);

export function effortsOfConfig(options: SessionConfigOption[]): { configId: string; values: string[]; current: string } | null {
  const opt = selectOf(options, "thought_level");
  if (!opt) return null;
  return { configId: opt.id, values: flatOptions(opt).map((o) => o.value), current: opt.currentValue };
}

export const modelConfigId = (options: SessionConfigOption[]) => selectOf(options, "model")?.id ?? null;

/* --- Permissions --------------------------------------------------------- */

/** The option to pick to answer `session/request_permission`, or null:
    answer `cancelled`, which every agent reads as a refusal.
    ⚠️ A ONE-TIME ANSWER NEVER BECOMES A PERMANENT ONE. An « Allow » the
    agent can only record as `allow_always` would have allowed every later
    call too — an order included — and a « Deny » recorded as
    `reject_always` would have barred the tool for good: with no
    once-option, the call is refused (cancelled) instead. `always` may fall
    back to the once-option: that grants less than asked, never more. */
export function pickPermissionOption(options: PermissionOption[], allow: boolean, always: boolean): string | null {
  const kind = (k: PermissionOption["kind"]) => options.find((o) => o.kind === k)?.optionId ?? null;
  if (allow) return always ? (kind("allow_always") ?? kind("allow_once")) : kind("allow_once");
  return always ? (kind("reject_always") ?? kind("reject_once")) : kind("reject_once");
}

/** The agent's mode for a turn, or null to leave it as it is.
    ⚠️ THE USER'S PICK WINS. A mode chosen in the agent's mode picker
    (`requested`: Codex « Full access ») is applied as is — the user decided
    (2026-09-27) that Codex in full access asks for NOTHING, the money
    actions excepted, which BytNode-AI confirms itself whatever the mode
    (`confirmCall`). With nothing picked, an agent that has an asking mode
    (`askMode`, Codex's `read-only`) starts in it: its default mode lets its
    own reviewer approve writes, commands and MCP calls without the user
    ever being asked. Otherwise the mode the session had before we put it
    in the asking one (`restore`). */
export function turnMode(modes: AgentModes | null, o: { requested: string | null; askMode: string | null; restore: string | null }): string | null {
  if (!modes) return null;
  const has = (v: string | null): v is string => v !== null && modes.options.some((m) => m.value === v);
  if (has(o.requested)) return o.requested;
  if (has(o.askMode)) return o.askMode;
  return has(o.restore) ? o.restore : null;
}

/* --- Cost ------------------------------------------------------------------ */

/** The cost of the current turn, from what the agent reports.
    ⚠️ AN ACP AGENT REPORTS ITS SESSION'S RUNNING TOTAL (Claude Code's
    `total_cost_usd`: 0.0192, then 0.0226, then 0.0359…), and the meter says
    « Turn cost »: it showed the total since the agent process started. We
    subtract the total at the start of the turn. Two traps: a cancelled turn
    reports `0` (dropped: nothing to learn), and a counter that goes DOWN
    has restarted (a new process, a resumed session) — the turn then counts
    from zero. One instance per session. */
export class TurnCost {
  private total: number | null = null;
  private start = 0;

  /** Called when a turn begins. */
  begin(): void {
    this.start = this.total ?? 0;
  }

  /** The turn's cost so far, or null when the report says nothing. */
  of(amount: number): number | null {
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (amount === 0 && (this.total ?? 0) > 0) return null;
    if (this.total !== null && amount < this.total) this.start = 0;
    this.total = amount;
    return Math.max(0, amount - this.start);
  }
}
