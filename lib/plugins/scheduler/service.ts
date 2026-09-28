import type { PlannedRun } from "./tasks";

export type { PlannedRun };

/* ---------------------------------------------------------------------------
   What the "Scheduled tasks" plugin offers the plugins that use it
   OPTIONALLY (the calendar): what the user's agent tasks will do next.

   The background itself (jobs, triggers) is not this plugin's: it is the
   core's clock (`../core/clock.ts`, `ctx.job`), there for every plugin
   whether this one runs or not.
--------------------------------------------------------------------------- */

export type AgentRunInput = {
  /** The BytNode-AI agent to run; its configuration comes from the session. */
  agentId: string;
  prompt: string;
  /** What the run is, for its frame: "Scheduled task: morning brief". */
  purpose: string;
  signal: AbortSignal;
};

export type AgentRunResult = { ok: true; text: string } | { ok: false; error: string };

export type SchedulerService = {
  /** The coming runs of the user's active agent tasks in a period. */
  planned(from: Date, to: Date): Promise<PlannedRun[]>;
};
