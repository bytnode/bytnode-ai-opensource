import type { Session } from "../core/contract";
import type { PlannedRun } from "./tasks";

export type { PlannedRun };

/* ---------------------------------------------------------------------------
   What the scheduler offers the plugins that depend on it: the background.

   A plugin registers JOBS (check the alerts, take the portfolio's
   snapshot, run a DCA purchase); they run on the Next server only, only
   while a tab is open (the session's keys), never twice at the same time,
   and go with the plugin that registered them. It can also run an AGENT in
   the background, with the tools of a sub-agent: nothing that waits for
   the user, nothing that commits funds. And it tells what the user's agent
   tasks will do next (the calendar shows it).
--------------------------------------------------------------------------- */

export type CatchUp = "skip" | "run-once-on-start";

export type JobRun = {
  session: Session;
  signal: AbortSignal;
  /** Why it runs: its schedule, a request (`trigger`), or a run missed
      while the app was closed. */
  reason: "schedule" | "manual" | "catch-up";
};

export type JobSpec = {
  /** Unique within the plugin that registers it. */
  id: string;
  title: string;
  /** `every 1 minute`, `daily at 07:00`… (`lib/plugins/core/frequency.ts`). */
  every: string;
  /** A run missed while the app was closed: skipped (default), or run once
      when it opens. */
  catchUp?: CatchUp;
  /** Returns a line for the run log, or throws. */
  run(run: JobRun): Promise<string | void>;
};

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
  /** Registers a job; it disappears with the plugin that registered it. */
  job(spec: JobSpec): void;
  /** Asks for a job of the caller to run as soon as possible — from any
      process (a tool served over MCP asks through the disk). */
  trigger(jobId: string): Promise<void>;
  /** Runs an agent in the background. */
  runAgent(input: AgentRunInput): Promise<AgentRunResult>;
  /** The coming runs of the user's active agent tasks in a period. */
  planned(from: Date, to: Date): Promise<PlannedRun[]>;
};
