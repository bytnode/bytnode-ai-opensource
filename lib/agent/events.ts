/* ---------------------------------------------------------------------------
   The events of an agent turn, from the server to the screen.

   The server runs the loop (model → tools → model) and narrates what
   happens, one JSON event per line. The browser replays them into the
   assistant's message: the text as it streams, each tool call with its
   result, the sub-agents. The same type serves on both sides.
--------------------------------------------------------------------------- */

import type { ToolCard } from "@/lib/tools/types";

/** An image to show in the thread: a path relative to the workspace
    (served by /api/files), or a data URL. */
export type ToolImage = { name: string; src: string };

/** An entry of the plan the agent set for itself (subscription agents). */
export type PlanEntry = { content: string; status: "pending" | "in_progress" | "completed" };

/** What a turn consumed. `context` / `window` feed the meter. */
export type UsageInfo = { input?: number; output?: number; cost?: number; context?: number; window?: number; provider?: string };

export type AgentEvent =
  | { type: "text"; text: string }
  /** The reasoning the model exposes, when it exposes it. */
  | { type: "thought"; text: string }
  | { type: "plan"; entries: PlanEntry[] }
  | { type: "usage"; usage: UsageInfo }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; output: string; images?: ToolImage[]; card?: ToolCard }
  /** A line produced while a tool is running (Monitor). */
  | { type: "tool_line"; id: string; line: string }
  /** A sub-agent (Workflow): `id` = `<call>:<index>`. Its profession and,
      once it is done, its report — the thread shows one then the other. An
      `activity` is one of its steps as it happens (a tool started or
      ended), filed on the row by its own id. */
  | { type: "subagent"; id: string; index: number; title: string; profession?: string; status: "running" | "done" | "failed"; report?: string; activity?: SubagentActivity }
  /** A transient error, retried: the thread can say so instead of letting
      the user believe nothing is happening. */
  | { type: "retry"; attempt: number; of: number; delayMs: number; reason: string }
  | { type: "error"; message: string }
  | { type: "done"; finishReason: string };

/** One step of an assistant reply, as it is stored and displayed. */
export type Step =
  | { type: "text"; text: string }
  /** The reasoning, folded by default in the thread and NEVER replayed to
      the model (`history.ts`): it is display, not context. */
  | { type: "thought"; text: string }
  | { type: "plan"; entries: PlanEntry[] }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** `pending`: the user's approval is awaited. `denied`: refused. */
      status: "pending" | "running" | "done" | "failed" | "denied";
      output?: string;
      lines?: string[];
      images?: ToolImage[];
      /** The sub-agents of a Workflow, by index: state then report. */
      subagents?: SubagentState[];
      /** The tool always asks (its policy): the prompt offers no "Always". */
      alwaysAsk?: boolean;
      /** The plugin's card for the result. */
      card?: ToolCard;
    };

/** One step of a sub-agent: a tool it called, what for, how it went
    (`lib/tools/agents/activity.ts`). */
export type SubagentActivity = { id: string; name: string; summary: string; status: "running" | "done" | "failed" };

export type SubagentState = { index: number; title: string; profession?: string; status: "running" | "done" | "failed"; report?: string; activity?: SubagentActivity[] };
