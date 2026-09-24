import { randomUUID } from "node:crypto";
import type { NotificationInput, Session } from "../core/contract";
import type { PluginStore } from "../core/store";
import type { AgentRunInput, AgentRunResult, CatchUp, JobRun, JobSpec } from "./service";
import { afterRun, decide, findAgent, runConversationId, taskKey, type AgentTask, type RunRecord, type RunState } from "./tasks";

/* ---------------------------------------------------------------------------
   The scheduler's clock.

   Every `TICK_MS`, while a session is live (a tab is open: the keys are
   there), it looks at every registered job and every active agent task:
   due → it runs, unless it is already running. The first tick after a
   period without a session applies each one's catch-up policy. A request
   to run now (`trigger`) can come from another process: it is written to
   `triggers.json` and picked up at the next tick. States go to
   `jobs.json`, finished agent tasks and job failures to `runs.jsonl`.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export const TICK_MS = 15_000;
const RUN_TIMEOUT = 12 * 60_000;
const MAX_RUNS = 500;

export const JOBS = "jobs.json";
export const TASKS = "tasks.json";
export const RUNS = "runs.jsonl";
const TRIGGERS = "triggers.json";

type Registered = { owner: string; spec: JobSpec };

export type ClockDeps = {
  store: PluginStore;
  session(): Session | null;
  notify(n: NotificationInput): Promise<unknown>;
  runAgent(input: AgentRunInput, session: Session): Promise<AgentRunResult>;
  log(message: string): void;
};

export class Clock {
  private readonly jobs = new Map<string, Registered>();
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private live = false;
  /** Stopped (the plugin stops): what was running is aborted, not failed. */
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: ClockDeps) {}

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    for (const r of this.running.values()) r.controller.abort();
  }

  /** Resolves when nothing runs any more. For the tests. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running.values()].map((r) => r.done));
  }

  register(id: string, owner: string, spec: JobSpec): () => void {
    this.jobs.set(id, { owner, spec });
    return () => void this.jobs.delete(id);
  }

  list(): Array<{ id: string; owner: string; title: string; every: string; running: boolean }> {
    return [...this.jobs.entries()].map(([id, { owner, spec }]) => ({ id, owner, title: spec.title, every: spec.every, running: this.running.has(id) }));
  }

  isRunning = (id: string) => this.running.has(id);

  /** Run as soon as possible — from any process. */
  async trigger(id: string): Promise<void> {
    await this.deps.store.update<string[]>(TRIGGERS, [], (ids) => [...new Set([...ids, id])]);
    if (this.timer) setTimeout(() => void this.tick(), 0);
  }

  /** One look at everything scheduled. Public for the tests. */
  async tick(now = Date.now()): Promise<void> {
    const session = this.deps.session();
    if (!session) {
      this.live = false;
      return;
    }
    if (this.ticking) return;
    this.ticking = true;
    try {
      const resumed = !this.live;
      this.live = true;
      let triggers: string[] = [];
      await this.deps.store.update<string[]>(TRIGGERS, [], (ids) => {
        triggers = ids;
        return [];
      });
      const states = await this.deps.store.read<Record<string, RunState>>(JOBS, {});
      const tasks = await this.deps.store.read<AgentTask[]>(TASKS, []);
      const updates: Record<string, RunState> = {};

      const consider = (id: string, every: string, catchUp: CatchUp, launch: (reason: JobRun["reason"]) => void) => {
        const state = states[id] ?? {};
        const d = decide(every, state, now, { resumed, catchUp, triggered: triggers.includes(id) });
        if ("error" in d) {
          if (state.lastMessage !== d.error) updates[id] = { ...state, lastStatus: "failed", lastMessage: d.error };
        } else if (!d.run) {
          if (d.state !== state) updates[id] = d.state;
        } else if (!this.running.has(id)) launch(d.reason);
      };

      for (const [id, { spec }] of this.jobs) consider(id, spec.every, spec.catchUp ?? "skip", (reason) => this.launchJob(id, spec, session, now, states[id] ?? {}, reason));
      for (const task of tasks) {
        const id = taskKey(task.id);
        if (task.status !== "active" && !triggers.includes(id)) continue;
        consider(id, task.frequency, task.catchUp, () => this.launchTask(id, task, session, now));
      }
      if (Object.keys(updates).length) await this.deps.store.update<Record<string, RunState>>(JOBS, {}, (s) => ({ ...s, ...updates }));
    } finally {
      this.ticking = false;
    }
  }

  private async settle(id: string, every: string, started: number, ok: boolean, message: string | undefined): Promise<void> {
    await this.deps.store.update<Record<string, RunState>>(JOBS, {}, (s) => ({ ...s, [id]: afterRun(every, started, ok, message) }));
  }

  /** Runs `work` under `id`, never twice at the same time. */
  private launch(id: string, work: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RUN_TIMEOUT)]);
    const done = work(signal)
      .catch((e: unknown) => this.deps.log(`[scheduler] ${id}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.running.delete(id));
    this.running.set(id, { controller, done });
  }

  private launchJob(id: string, spec: JobSpec, session: Session, started: number, previous: RunState, reason: JobRun["reason"]): void {
    this.launch(id, async (signal) => {
      let message: string | void;
      try {
        message = await spec.run({ session, signal, reason });
      } catch (e) {
        if (this.stopped) return;
        const error = e instanceof Error ? e.message : String(e);
        await this.settle(id, spec.every, started, false, error);
        await this.deps.store.append(RUNS, { id: randomUUID().slice(0, 12), kind: "job", ref: id, title: spec.title, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), ok: false, error } satisfies RunRecord, MAX_RUNS);
        /* Said once when it starts failing, not at every run. A job is its
           plugin's machinery: the Scheduled tasks tab does not show it. */
        if (previous.lastStatus !== "failed") await this.deps.notify({ title: `${spec.title} failed`, body: error, level: "error" });
        return;
      }
      await this.settle(id, spec.every, started, true, message ?? undefined);
    });
  }

  private launchTask(id: string, task: AgentTask, session: Session, started: number): void {
    this.launch(id, async (signal) => {
      const result = await this.deps.runAgent({ agentId: task.agent, prompt: task.prompt, purpose: `scheduled task "${task.title}", ${task.frequency}`, signal }, session);
      if (this.stopped) return;
      const agent = findAgent(session.agents, task.agent);
      const record: RunRecord = {
        id: randomUUID().slice(0, 12),
        kind: "task",
        ref: task.id,
        title: task.title,
        ...(agent ? { agentId: agent.id } : {}),
        prompt: task.prompt,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        ok: result.ok,
        ...(result.ok ? { text: result.text } : { error: result.error }),
      };
      await this.deps.store.append(RUNS, record, MAX_RUNS);
      await this.settle(id, task.frequency, started, result.ok, result.ok ? "done" : result.error);
      await this.deps.notify({
        title: result.ok ? `Scheduled task: ${task.title}` : `Scheduled task failed: ${task.title}`,
        body: result.ok ? firstLine(result.text) : result.error,
        level: result.ok ? "success" : "error",
        /* A report becomes a conversation; a failure is read in the view. */
        action: result.ok && agent ? { kind: "open-conversation", conversationId: runConversationId(record.id) } : { kind: "open-view", view: "scheduler" },
      });
    });
  }
}

const firstLine = (text: string) => {
  const line = text.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
};
