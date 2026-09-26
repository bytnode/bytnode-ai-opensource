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
function toolName(update: Pick<ToolCallUpdate, "name" | "kind" | "_meta">): string | null {
  const meta = update._meta?.claudeCode;
  const fromMeta = isRecord(meta) && typeof meta.toolName === "string" ? meta.toolName : null;
  return update.name?.trim() || fromMeta || (update.kind ? KIND_LABELS[update.kind] : null);
}

const argsOf = (update: Pick<ToolCallUpdate, "rawInput" | "title">): Record<string, unknown> | null => {
  if (isRecord(update.rawInput) && Object.keys(update.rawInput).length > 0) return update.rawInput;
  return update.title ? { title: update.title } : null;
};

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
    case "usage_update": {
      const u = update as { used?: number; size?: number; cost?: { amount?: number } };
      const usage: UsageInfo = {};
      if (typeof u.used === "number") usage.context = u.used;
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
    ...(Array.isArray(update.rawOutput) ? update.rawOutput : isRecord(update.rawOutput) && Array.isArray(update.rawOutput.content) ? update.rawOutput.content : []),
    ...(typeof update.rawOutput === "string" ? [{ type: "text", text: update.rawOutput }] : []),
  ];
  for (const b of blocks) {
    const card = isRecord(b) && b.type === "resource" ? cardOfResource(b.resource) : isRecord(b) && b.type === "text" && typeof b.text === "string" ? cardInText(b.text) : undefined;
    if (card) return card;
  }
  return undefined;
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
  for (const line of text.split("\n")) if (line.startsWith(`${CARD_URI} `)) return parseCard(line.slice(CARD_URI.length + 1));
  return undefined;
}

/** A text part that only carries the card: not shown as the output. */
const carriesCard = (text: string) => text.includes(CARD_URI) && cardInText(text) !== undefined;

/** What we show as a call's output: its text contents, a diff summarised
    by its path and its new text, otherwise the raw output. */
export function toolOutputOf(update: Pick<ToolCallUpdate, "toolCallId" | "content" | "rawOutput" | "status">): string {
  /* A failure: the raw error first, the diff that was not applied teaches
     nothing. */
  if (update.status === "failed" && typeof update.rawOutput === "string" && update.rawOutput.trim()) return update.rawOutput;
  const parts: string[] = [];
  for (const c of update.content ?? []) {
    const text = contentText(c);
    if (!carriesCard(text)) parts.push(text);
  }
  const text = parts.filter(Boolean).join("\n").trim();
  if (text) return text;
  const raw = update.rawOutput;
  if (raw === undefined || raw === null) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
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

/** The option to pick to answer `session/request_permission`. */
export function pickPermissionOption(options: PermissionOption[], allow: boolean, always: boolean): string | null {
  const kind = (k: PermissionOption["kind"]) => options.find((o) => o.kind === k)?.optionId ?? null;
  if (allow) return (always ? kind("allow_always") : null) ?? kind("allow_once") ?? kind("allow_always");
  return kind("reject_once") ?? kind("reject_always");
}
