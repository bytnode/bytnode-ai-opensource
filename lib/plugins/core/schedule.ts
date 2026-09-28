import { missedSince, nextRun, parseFrequency, type Frequency } from "./frequency";

/* ---------------------------------------------------------------------------
   When something scheduled runs: the rules of the core's clock
   (`clock.ts`), for the plugins' jobs and the user's agent tasks alike —
   when it is due, what to do with a run missed while the app was closed,
   what a run leaves behind. Pure, tested (`scheduler/tasks.test.ts`).
--------------------------------------------------------------------------- */

/** A run missed while the app was closed: skipped (default), or run once
    when it opens. */
export type CatchUp = "skip" | "run-once-on-start";

/** What happened last, and what comes next, for a job or a task. */
export type RunState = {
  lastRun?: string;
  lastStatus?: "ok" | "failed";
  lastMessage?: string;
  nextRun?: string;
  /** The frequency the next run was computed with: if it changes, the next
      run is computed again. */
  every?: string;
};

/** A finished run of an agent task (and the failures of jobs): the log
    the view reads, and what the browser turns into a conversation. */
export type RunRecord = {
  id: string;
  kind: "task" | "job";
  ref: string;
  title: string;
  agentId?: string;
  prompt?: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  text?: string;
  error?: string;
};

export type Decision = { run: false; state: RunState } | { run: true; reason: "schedule" | "manual" | "catch-up" };

/** What to do with a job or a task at `now`. `resumed`: the first tick
    after a period without a live session (app closed, no tab open). */
export function decide(every: string, state: RunState, now: number, opts: { resumed: boolean; catchUp: CatchUp; triggered: boolean }): Decision | { error: string } {
  const f = parseFrequency(every);
  if ("error" in f) return { error: f.error };
  if (opts.triggered) return { run: true, reason: "manual" };
  const last = state.lastRun ? Date.parse(state.lastRun) : undefined;
  const known = state.nextRun && state.every === every ? Date.parse(state.nextRun) : undefined;
  /* Missed while nothing ran: after a run, an occurrence came and went;
     before the first one, the planned first run is well past (a task
     created in the evening for "daily at 08:00", app closed overnight). */
  const missed = last !== undefined ? missedSince(f, last, now) : known !== undefined && known + MISSED_GRACE < now;
  if (opts.resumed && missed) {
    if (opts.catchUp === "run-once-on-start") return { run: true, reason: "catch-up" };
    return { run: false, state: { ...state, nextRun: new Date(upcoming(f, now)).toISOString(), every } };
  }
  const due = known ?? (last !== undefined ? nextRun(f, last) : firstRun(f, now));
  if (due <= now) return { run: true, reason: "schedule" };
  return known === undefined ? { run: false, state: { ...state, nextRun: new Date(due).toISOString(), every } } : { run: false, state };
}

/** A first run planned less than this ago is not "missed": an interval
    task is planned for the moment it was made, and the app's first tick
    after a restart is a resumed one. */
const MISSED_GRACE = 2 * 60_000;

/** A new schedule: an interval starts at once, a time of day waits for it. */
const firstRun = (f: Frequency, now: number) => (f.kind === "interval" ? now : nextRun(f, now));

/** The next occurrence strictly after `now`. */
const upcoming = (f: Frequency, now: number) => (f.kind === "interval" ? now + f.minutes * 60_000 : nextRun(f, now));

/** The state after a run that started at `startedAt`. */
export function afterRun(every: string, startedAt: number, ok: boolean, message: string | undefined): RunState {
  const f = parseFrequency(every);
  return {
    lastRun: new Date(startedAt).toISOString(),
    lastStatus: ok ? "ok" : "failed",
    ...(message ? { lastMessage: message.slice(0, 500) } : {}),
    ...("error" in f ? {} : { nextRun: new Date(Math.max(nextRun(f, startedAt), startedAt + 30_000)).toISOString(), every }),
  };
}
