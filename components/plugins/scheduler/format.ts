import type { AgentTask, RunRecord, RunState } from "@/lib/plugins/scheduler/tasks";

/* The Scheduled tasks tab's shapes and small words, shared by its parts. */

export type TaskRow = AgentTask & { state: RunState; running: boolean };
export type RunRow = Omit<RunRecord, "text"> & { excerpt?: string };
/** What the plugin's `state` action answers; `at` is the server's now. */
export type SchedulerState = { at: string; tasks: TaskRow[]; runs: RunRow[] };

/* Apple's system colours, never green or red — those say how a run went. */
const HUES = ["#0a84ff", "#bf5af2", "#ff9f0a", "#40c8e0", "#5e5ce6", "#ff375f", "#64d2ff", "#ffd60a"];

/** A stable colour for an agent's name. */
export function hueOf(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
