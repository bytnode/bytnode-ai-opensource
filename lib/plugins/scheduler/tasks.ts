import type { AgentConfig } from "@/lib/domain/types";
import { missedSince, nextRun, parseFrequency, type Frequency } from "../core/frequency";
import type { CatchUp } from "./service";

/* ---------------------------------------------------------------------------
   What the scheduler decides: when something is due, what to do with a run
   missed while the app was closed, and how a background run is framed.

   Two kinds of scheduled things share these rules: the JOBS other plugins
   register (no model) and the user's AGENT TASKS ("a market brief every
   morning at 8"). Pure, tested.
--------------------------------------------------------------------------- */

export type AgentTask = {
  id: string;
  title: string;
  prompt: string;
  /** The agent, by id or name (resolved when it runs: a task created by a
      subscription agent's tool only knows what it was told). */
  agent: string;
  frequency: string;
  catchUp: CatchUp;
  status: "active" | "paused";
  createdAt: string;
};

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
  if (opts.resumed && last !== undefined && missedSince(f, last, now)) {
    if (opts.catchUp === "run-once-on-start") return { run: true, reason: "catch-up" };
    return { run: false, state: { ...state, nextRun: new Date(upcoming(f, now)).toISOString(), every } };
  }
  const known = state.nextRun && state.every === every ? Date.parse(state.nextRun) : undefined;
  const due = known ?? (last !== undefined ? nextRun(f, last) : firstRun(f, now));
  if (due <= now) return { run: true, reason: "schedule" };
  return known === undefined ? { run: false, state: { ...state, nextRun: new Date(due).toISOString(), every } } : { run: false, state };
}

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

/** The agent a task names, by id or by name. */
export const findAgent = (agents: AgentConfig[], ref: string): AgentConfig | undefined => {
  const r = ref.trim().toLowerCase();
  return agents.find((a) => a.id === ref) ?? agents.find((a) => a.name.trim().toLowerCase() === r);
};

/** A task as the agent or the view creates it: checked, or why not. */
export function newTask(input: { title?: unknown; prompt?: unknown; agent?: unknown; frequency?: unknown; catchUp?: unknown }, id: string, now: Date): AgentTask | { error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const agent = typeof input.agent === "string" ? input.agent.trim() : "";
  const frequency = typeof input.frequency === "string" ? input.frequency.trim() : "";
  if (!title) return { error: "Give the task a title." };
  if (!prompt) return { error: "Give the task its instructions (`prompt`)." };
  if (!agent) return { error: "Which agent runs the task?" };
  const f = parseFrequency(frequency);
  if ("error" in f) return { error: f.error };
  if (f.kind === "interval" && f.minutes < 15) return { error: "An agent task runs at most every 15 minutes: it costs a model's time." };
  return { id, title: title.slice(0, 120), prompt: prompt.slice(0, 8000), agent, frequency, catchUp: input.catchUp === "run-once-on-start" ? "run-once-on-start" : "skip", status: "active", createdAt: now.toISOString() };
}

/** The conversation a finished task becomes in the browser. */
export const runConversationId = (runId: string) => `run-${runId}`;

/** Where a task's state is kept, next to the jobs' (`jobs.json`). */
export const taskKey = (id: string) => `task:${id}`;

export type TaskAction = "pause" | "resume" | "delete";

/** A task named by its id or its title. */
export const findTask = (tasks: AgentTask[], ref: string): AgentTask | undefined => {
  const r = ref.trim().toLowerCase();
  return tasks.find((t) => t.id === ref.trim()) ?? tasks.find((t) => t.title.toLowerCase() === r);
};

/** Pauses, resumes or deletes a task: the new list, or why not. */
export function changeTask(tasks: AgentTask[], ref: string, action: TaskAction): { tasks: AgentTask[]; task: AgentTask } | { error: string } {
  const task = findTask(tasks, ref);
  if (!task) return { error: `No scheduled task "${ref}". TaskList shows them.` };
  if (action === "delete") return { tasks: tasks.filter((t) => t.id !== task.id), task };
  const changed: AgentTask = { ...task, status: action === "pause" ? "paused" : "active" };
  return { tasks: tasks.map((t) => (t.id === task.id ? changed : t)), task: changed };
}

/** A date in the machine's local time, like the frequencies: "2026-09-23 08:00". */
export const shortDate = (iso: string | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** One line per task, for a tool's output. */
export function taskLines(tasks: AgentTask[], states: Record<string, RunState>): string[] {
  return tasks.map((t) => {
    const s = states[taskKey(t.id)] ?? {};
    const last = s.lastRun ? `last ${shortDate(s.lastRun)} (${s.lastStatus === "failed" ? `failed: ${s.lastMessage ?? "?"}` : "ok"})` : "never run";
    const next = t.status === "paused" ? "paused" : `next ${shortDate(s.nextRun)}`;
    return `- ${t.title} [${t.id}] — agent ${t.agent}, ${t.frequency}; ${last}; ${next}`;
  });
}

/** A coming run of an agent task, as the calendar shows it. */
export type PlannedRun = {
  taskId: string;
  title: string;
  /** The agent's name when it is known, else what the task names. */
  agent: string;
  frequency: string;
  /** ISO. For a task that runs more often than hourly: the day, at 00:00 UTC. */
  at: string;
  /** More often than hourly: one entry for the day rather than dozens. */
  allDay: boolean;
};

const HOURLY = 60;
const MAX_PLANNED = 500;

/** The coming runs of the active tasks between `from` and `to` — from
    `now` on: what already ran is in the run log, not in the plan. A task
    that runs more often than hourly gets one all-day entry per day. */
export function plannedRuns(tasks: AgentTask[], states: Record<string, RunState>, from: number, to: number, now: number, agentName: (ref: string) => string = (r) => r): PlannedRun[] {
  const out: PlannedRun[] = [];
  const start = Math.max(from, now);
  for (const t of tasks) {
    if (t.status !== "active") continue;
    const f = parseFrequency(t.frequency);
    if ("error" in f) continue;
    const base = { taskId: t.id, title: t.title, agent: agentName(t.agent), frequency: t.frequency };
    if (f.kind === "interval" && f.minutes < HOURLY) {
      for (let d = new Date(start); d.getTime() <= to && out.length < MAX_PLANNED; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const p = (n: number) => String(n).padStart(2, "0");
        out.push({ ...base, at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00.000Z`, allDay: true });
      }
      continue;
    }
    const s = states[taskKey(t.id)] ?? {};
    const known = s.nextRun && s.every === t.frequency ? Date.parse(s.nextRun) : NaN;
    /* An interval counts from its known next run; a time of day falls on
       its time whatever the past. */
    let at = f.kind === "interval" ? (Number.isFinite(known) ? known : s.lastRun ? nextRun(f, Date.parse(s.lastRun)) : now) : nextRun(f, start - 1);
    if (f.kind === "interval" && at < start) at += Math.ceil((start - at) / (f.minutes * 60_000)) * f.minutes * 60_000;
    for (; at <= to && out.length < MAX_PLANNED; at = nextRun(f, at)) out.push({ ...base, at: new Date(at).toISOString(), allDay: false });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The frame of a background run: who is (not) there, what it may do,
    what it must hand back. */
export function backgroundFrame(purpose: string, now: Date): string {
  return [
    "## Background run",
    "",
    `You are running without the user (${purpose}), on ${now.toISOString().slice(0, 16).replace("T", " ")} UTC. Nobody can answer a question or approve an action: do not ask, decide within these limits.`,
    "You have a sub-agent's tools — the workspace, the web, the market data, the exchange accounts read-only; you cannot place, cancel or close an order, move funds, open a view, or delegate to sub-agents.",
    "Work from sourced, dated data (BytNode, the exchange, the web) — never from memory for a figure.",
    "End with a clear, self-contained report: what you found, each figure with its source and time, and what the user may want to do. It is delivered to them as a conversation.",
  ].join("\n");
}
