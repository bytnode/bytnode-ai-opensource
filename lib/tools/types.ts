/* ---------------------------------------------------------------------------
   What a tool is, for the agent as well as for the UI.

   A tool has a name, a description the model reads, a JSON schema for its
   arguments, and a function that executes it in a CONTEXT: the agent's
   workspace, an abort signal, an event emitter for whatever has to reach
   the screen during execution (the lines of a Monitor, the progress of a
   sub-agent).

   ⚠️ EVERYTHING THAT TOUCHES THE DISK GOES THROUGH `ctx.workspace`. Relative
   paths resolve against it; an absolute path that leaves it is refused by
   `paths.ts`. Shells, for their part, start there — that is the sandbox.
--------------------------------------------------------------------------- */

import type { AgentEvent } from "@/lib/agent/events";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { Scope } from "./paths";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** An image produced or read by a tool: sent to the model (dataUrl) and,
    when it sits in the workspace, shown in the thread (path). */
export type ToolAttachment = { type: "image"; dataUrl: string; name: string; path?: string };

export type ToolResult = {
  ok: boolean;
  /** What the model receives. Always text; bounded by `truncate`. */
  output: string;
  /** What the model receives IN ADDITION, beyond text: an image that was read. */
  attachments?: ToolAttachment[];
};

export type ToolContext = {
  /** The agent's workspace, absolute, existing. */
  workspace: string;
  /** What the file tools accept outside that folder: nothing
      (`workspace`) or everything (`disk`). */
  scope: Scope;
  /** The project root (shared skills). */
  projectRoot: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  /** Nesting depth: 0 for the main agent, 1 for a sub-agent. A sub-agent
      launches no sub-agents. */
  depth: number;
  /** What a tool needs to call a model itself (Workflow). */
  llm: { apiKey: string; model: string; effort: string | null };
  /** The id of the current call, to attach the emitted events to. */
  callId: string;
  /** The skills specific to the agent's profession, already read. */
  professionSkills?: Array<{ name: string; description: string; path: string }>;
  /** The BytNode key, so a sub-agent gets the same tools back. */
  bytnodeKey?: string;
  /** The exchange accounts the agent may drive (already filtered). */
  exchangeAccounts?: ExchangeAccount[];
};

/** What a tool may do without the user, as it declares it. Every field
    is optional; `resolvePolicy` (`policy.ts`) fills in the rest and
    applies the core's floor — a tool that declares nothing is treated as
    sensitive: it asks, and no sub-agent receives it. */
export type DeclaredPolicy = {
  /** No side effect beyond reading. */
  readOnly?: boolean;
  /** Waits for the user's approval in "Ask before acting" mode. */
  gated?: boolean;
  /** Asks even in "Direct execution", never offers "Always". */
  alwaysAsk?: boolean;
  /** Given to Workflow sub-agents and to background runs, which have
      nobody to ask. */
  subagent?: boolean;
};

/** The policy once resolved: every field decided. */
export type ToolPolicy = Required<DeclaredPolicy>;

export interface Tool<A = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** See `DeclaredPolicy`. Absent: sensitive. */
  policy?: DeclaredPolicy;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

/** What the model receives must not blow up the context: every output is
    cut beyond a reasonable size, and says so. */
export const OUTPUT_LIMIT = 40_000;

export function truncate(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[… output truncated: ${text.length - limit} more characters]`;
}

export const ok = (output: string, attachments?: ToolAttachment[]): ToolResult => ({
  ok: true,
  output: truncate(output),
  ...(attachments?.length ? { attachments } : {}),
});

export const fail = (message: string): ToolResult => ({ ok: false, output: truncate(message) });

/** An error as text, whatever its shape. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
