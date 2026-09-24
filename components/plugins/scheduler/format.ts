import type { AgentTask, RunRecord, RunState } from "@/lib/plugins/scheduler/tasks";
import { pluginManifest } from "@/lib/plugins/catalog";

/* The Scheduled tasks tab's shapes and small words, shared by its parts. */

export type TaskRow = AgentTask & { state: RunState; running: boolean };
export type JobRow = { id: string; owner: string; title: string; every: string; running: boolean; state: RunState };
export type RunRow = Omit<RunRecord, "text"> & { excerpt?: string };
/** What the plugin's `state` action answers; `at` is the server's now. */
export type SchedulerState = { at: string; tasks: TaskRow[]; jobs: JobRow[]; runs: RunRow[] };

/** A plugin's name, for a job it registered. */
export const pluginName = (id: string): string => pluginManifest(id)?.name ?? id;

/* Apple's system colours, never green or red — those say how a run went. */
const HUES = ["#0a84ff", "#bf5af2", "#ff9f0a", "#40c8e0", "#5e5ce6", "#ff375f", "#64d2ff", "#ffd60a"];

/** A stable colour for a name: an agent's, a plugin's. */
export function hueOf(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** How a run went, as a class: `is-ok`, `is-failed`, or never run. */
export const outcomeOf = (state: RunState): string => (state.lastStatus === "failed" ? "is-failed" : state.lastRun ? "is-ok" : "is-never");
