import type { SubagentActivity } from "@/lib/agent/events";
import { summarizeCall } from "@/lib/tools/names";

/* ---------------------------------------------------------------------------
   What a sub-agent is doing, step by step (user request, 2026-10-08: « le
   sub-agent est une boîte noire »).

   Each tool call a sub-agent makes becomes one ACTIVITY — its tool, a short
   summary of what it was asked (`summarizeCall`: the file, the command, the
   query) and its state — sent to the thread as it happens (the Workflow
   row unfolds on it) and, at the end, handed to the main agent with the
   report as a compact list of the steps taken (`withTrace`), so it can
   judge how the report was made. The thread's parser strips that list
   back off the report (`stripTrace`). Pure, tested; both engines (key and
   subscription) use it.
--------------------------------------------------------------------------- */

/** The steps kept per sub-agent (thread and trace). */
export const ACTIVITY_MAX = 40;
const SUMMARY_MAX = 140;
export const TRACE_OPEN = "<subagent_steps>";
export const TRACE_CLOSE = "</subagent_steps>";

const short = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

/** The steps of one sub-agent, as they come. */
export class ActivityLog {
  readonly steps: SubagentActivity[] = [];

  /** A tool call started: its activity (to send). */
  start(id: string, name: string, args: Record<string, unknown>): SubagentActivity {
    const a: SubagentActivity = { id, name: displayName(name), summary: short(summarizeCall(displayName(name), args).replace(/\s+/g, " ").trim()), status: "running" };
    this.steps.push(a);
    if (this.steps.length > ACTIVITY_MAX) this.steps.splice(0, this.steps.length - ACTIVITY_MAX);
    return a;
  }

  /** A tool call ended: its activity updated (to send), or null if unknown. */
  finish(id: string, ok: boolean): SubagentActivity | null {
    const a = this.steps.find((s) => s.id === id);
    if (!a) return null;
    a.status = ok ? "done" : "failed";
    return { ...a };
  }
}

/** `mcp__bytnode-ai__ChartTool` reads as `ChartTool`. Pure. */
export const displayName = (name: string) => name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");

/** The steps as the main agent reads them: one line each. Pure. */
export function traceOf(steps: SubagentActivity[]): string {
  return steps.map((s) => `${s.status === "failed" ? "✗" : s.status === "running" ? "…" : "✓"} ${s.name}${s.summary ? ` — ${s.summary}` : ""}`).join("\n");
}

/** The report with the steps that made it, for the main agent. Pure. */
export function withTrace(report: string, steps: SubagentActivity[]): string {
  if (steps.length === 0) return report;
  return `${report.trim()}\n\n${TRACE_OPEN}\nThe steps this sub-agent took (✓ done, ✗ failed):\n${traceOf(steps)}\n${TRACE_CLOSE}`;
}

/** A report without its steps (the thread shows them on its own). Pure. */
export function stripTrace(body: string): string {
  const at = body.indexOf(TRACE_OPEN);
  if (at < 0) return body;
  const end = body.indexOf(TRACE_CLOSE, at);
  return (body.slice(0, at) + (end < 0 ? "" : body.slice(end + TRACE_CLOSE.length))).trim();
}
