import { randomUUID } from "node:crypto";
import type { NotificationInput, Session } from "./contract";
import { afterRun, decide, type CatchUp, type RunRecord, type RunState } from "./schedule";
import type { PluginStore } from "./store";

/* ---------------------------------------------------------------------------
   The core's clock: the background of every plugin.

   A plugin registers JOBS (`ctx.job`: check the alerts, take the
   portfolio's snapshot, run the due DCA purchases) or a SOURCE of jobs read
   again at every tick (`ctx.jobs`: the user's agent tasks, which a
   subscription session's MCP server may change from another process).
   Every `TICK_MS`, while a session is live (a tab is open: the keys are
   there), each due job runs, unless it is already running. The first tick
   after a period without a session applies each one's catch-up policy. A
   request to run now (`trigger`) can come from another process: it is
   written to `triggers.json` and picked up at the next tick. States go to
   `jobs.json`, job failures to `runs.jsonl`.

   It belongs to the core, not to a plugin: switching a plugin off never
   stops another one's background work. Its files stay where the
   "Scheduled tasks" plugin kept them (`plugins/scheduler/`), so nothing
   moved. SERVER-ONLY.
--------------------------------------------------------------------------- */

export const TICK_MS = 15_000;
const RUN_TIMEOUT = 12 * 60_000;
/** The run log keeps this many entries. */
export const MAX_RUNS = 500;
/** A run that broke outside its own error handling (the disk refused its
    record…) waits this long before it is tried again, instead of being
    relaunched at every tick. */
const BROKEN_BACKOFF_MS = 5 * 60_000;

/** The store the clock keeps its files in — the scheduler's, historically. */
export const CLOCK_STORE = "scheduler";
export const JOBS = "jobs.json";
export const RUNS = "runs.jsonl";
const TRIGGERS = "triggers.json";

export type JobRun = {
  session: Session;
  signal: AbortSignal;
  /** Why it runs: its schedule, a request (`trigger`), or a run missed
      while the app was closed. */
  reason: "schedule" | "manual" | "catch-up";
  /** True once the run no longer matters: the app stops, or the plugin
      that registered it stopped. Nothing is to be recorded then. */
  cancelled(): boolean;
};

export type JobSpec = {
  /** Unique within the plugin that registers it. */
  id: string;
  title: string;
  /** `every 1 minute`, `daily at 07:00`… (`frequency.ts`). */
  every: string;
  /** A run missed while the app was closed: skipped (default), or run once
      when it opens. */
  catchUp?: CatchUp;
  /** Not run on its schedule, only when asked (`trigger`). */
  paused?: boolean;
  /** Returns a line for its state, or throws. */
  run(run: JobRun): Promise<string | void>;
};

/** Thrown by a job that already said what went wrong (its own record, its
    own notification): the clock only marks the run failed. */
export class JobFailure extends Error {}

export type ClockDeps = {
  store: PluginStore;
  session(): Session | null;
  notify(owner: string, n: NotificationInput): Promise<unknown>;
  log(message: string): void;
};

type Registered = { owner: string; spec: JobSpec };
type Source = { owner: string; list: () => Promise<JobSpec[]> };
type Running = { controller: AbortController; done: Promise<void>; owner: string; cancelled: boolean };

export class Clock {
  private readonly jobs = new Map<string, Registered>();
  private readonly sources = new Set<Source>();
  private readonly running = new Map<string, Running>();
  /** Keys whose last run broke, and until when they wait. */
  private readonly broken = new Map<string, number>();
  private live = false;
  /** Stopped (the app stops): what was running is aborted, not failed. */
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: ClockDeps) {}

  start(): void {
    /* ⚠️ A tick that rejects (the disk busy) must not become an unhandled
       rejection: logged, and the next tick tries again. */
    this.timer ??= setInterval(() => void this.tick().catch((e: unknown) => this.deps.log(`[clock] tick failed: ${e instanceof Error ? e.message : String(e)}`)), TICK_MS);
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

  /** A job under `key` (`<plugin>:<id>`); the returned function removes it
      and cancels a run of it in progress. */
  register(key: string, owner: string, spec: JobSpec): () => void {
    this.jobs.set(key, { owner, spec });
    return () => {
      if (this.jobs.get(key)?.spec === spec) this.jobs.delete(key);
      this.cancel((k) => k === key);
    };
  }

  /** Jobs read again at every tick, keyed `<owner>:<id>`. */
  source(owner: string, list: () => Promise<JobSpec[]>): () => void {
    const s: Source = { owner, list };
    this.sources.add(s);
    return () => {
      this.sources.delete(s);
      this.cancel((_k, r) => r.owner === owner && !this.ownsRegistered(owner, _k));
    };
  }

  private ownsRegistered = (owner: string, key: string) => this.jobs.get(key)?.owner === owner;

  private cancel(match: (key: string, r: Running) => boolean): void {
    for (const [key, r] of this.running) {
      if (!match(key, r)) continue;
      r.cancelled = true;
      r.controller.abort();
    }
  }

  /** The registered job under this key. For the tests. */
  spec(key: string): JobSpec | undefined {
    return this.jobs.get(key)?.spec;
  }

  list(): Array<{ id: string; owner: string; title: string; every: string; running: boolean }> {
    return [...this.jobs.entries()].map(([id, { owner, spec }]) => ({ id, owner, title: spec.title, every: spec.every, running: this.running.has(id) }));
  }

  isRunning = (key: string) => this.running.has(key);

  /** Run as soon as possible — from any process. */
  async trigger(key: string): Promise<void> {
    await this.deps.store.update<string[]>(TRIGGERS, [], (ids) => [...new Set([...ids, key])]);
    if (this.timer) setTimeout(() => void this.tick().catch(() => {}), 0);
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
      const updates: Record<string, RunState> = {};

      const all: Array<[string, Registered]> = [...this.jobs.entries()];
      for (const s of this.sources) {
        try {
          for (const spec of await s.list()) all.push([`${s.owner}:${spec.id}`, { owner: s.owner, spec }]);
        } catch (e) {
          this.deps.log(`[clock] the jobs of ${s.owner} could not be read: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      for (const [key, { owner, spec }] of all) {
        const triggered = triggers.includes(key);
        if (spec.paused && !triggered) continue;
        if ((this.broken.get(key) ?? 0) > now && !triggered) continue;
        const state = states[key] ?? {};
        const d = decide(spec.every, state, now, { resumed, catchUp: spec.catchUp ?? "skip", triggered });
        if ("error" in d) {
          if (state.lastMessage !== d.error) updates[key] = { ...state, lastStatus: "failed", lastMessage: d.error };
        } else if (!d.run) {
          if (d.state !== state) updates[key] = d.state;
        } else if (!this.running.has(key)) this.launch(key, owner, spec, session, now, state, d.reason);
      }
      if (Object.keys(updates).length) await this.deps.store.update<Record<string, RunState>>(JOBS, {}, (s) => ({ ...s, ...updates }));
    } finally {
      this.ticking = false;
    }
  }

  private async settle(key: string, every: string, started: number, ok: boolean, message: string | undefined): Promise<void> {
    await this.deps.store.update<Record<string, RunState>>(JOBS, {}, (s) => ({ ...s, [key]: afterRun(every, started, ok, message) }));
  }

  /** Runs a job under `key`, never twice at the same time. */
  private launch(key: string, owner: string, spec: JobSpec, session: Session, started: number, previous: RunState, reason: JobRun["reason"]): void {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(RUN_TIMEOUT)]);
    const entry: Running = { controller, owner, cancelled: false, done: Promise.resolve() };
    const cancelled = () => this.stopped || entry.cancelled;
    const work = async () => {
      let message: string | void;
      try {
        message = await spec.run({ session, signal, reason, cancelled });
      } catch (e) {
        if (cancelled()) return;
        const error = e instanceof Error ? e.message : String(e);
        await this.settle(key, spec.every, started, false, error);
        if (e instanceof JobFailure) return;
        await this.deps.store.append(RUNS, { id: randomUUID().slice(0, 12), kind: "job", ref: key, title: spec.title, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), ok: false, error } satisfies RunRecord, MAX_RUNS);
        /* Said once when it starts failing, not at every run. A job is its
           plugin's machinery: the Scheduled tasks tab does not show it. */
        if (previous.lastStatus !== "failed") await this.deps.notify(owner, { title: `${spec.title} failed`, body: error, level: "error" });
        return;
      }
      if (cancelled()) return;
      await this.settle(key, spec.every, started, true, message ?? undefined);
    };
    entry.done = work()
      .then(() => void this.broken.delete(key))
      .catch((e: unknown) => {
        /* Broken outside the job's own handling: it waits, rather than
           being launched again at every tick with nothing said. */
        this.broken.set(key, started + BROKEN_BACKOFF_MS);
        this.deps.log(`[clock] ${key}: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, entry);
  }
}
