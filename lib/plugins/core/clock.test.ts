import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { Clock, JOBS, JobFailure, RUNS, type ClockDeps, type JobSpec } from "./clock";
import type { NotificationInput, Session } from "./contract";
import { afterRun, type RunRecord, type RunState } from "./schedule";
import { pluginStore, type PluginStore } from "./store";

const at = (h: number, m = 0, d = 23) => new Date(2026, 8, d, h, m).getTime();
const SESSION = { agents: [{ id: "a1", name: "Analyst" }] as AgentConfig[] } as Session;

let root: string;
let store: PluginStore;
let session: Session | null;
let notes: NotificationInput[];
let logs: string[];
let clock: Clock;

const deps = (): ClockDeps => ({ store, session: () => session, notify: async (_owner, n) => void notes.push(n), log: (m) => void logs.push(m) });
const states = () => store.read<Record<string, RunState>>(JOBS, {});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-clock-"));
  store = pluginStore("scheduler", root);
  session = SESSION;
  notes = [];
  logs = [];
  clock = new Clock(deps());
});

afterEach(async () => {
  clock.stop();
  await clock.idle();
  await fs.rm(root, { recursive: true, force: true });
});

const job = (over: Partial<JobSpec> = {}): JobSpec => ({ id: "snap", title: "Snapshot", every: "every 5 minutes", run: vi.fn(async () => "done"), ...over });

describe("the core clock — jobs", () => {
  it("runs a due job while a session is live, and records its state", async () => {
    const spec = job();
    clock.register("portfolio:snap", "portfolio", spec);
    session = null;
    await clock.tick(at(10));
    expect(spec.run).not.toHaveBeenCalled();
    session = SESSION;
    await clock.tick(at(10));
    await clock.idle();
    expect(spec.run).toHaveBeenCalledWith(expect.objectContaining({ session: SESSION, reason: "schedule" }));
    expect((await states())["portfolio:snap"]).toMatchObject({ lastStatus: "ok", lastMessage: "done", nextRun: new Date(at(10, 5)).toISOString() });
    await clock.tick(at(10, 3));
    await clock.idle();
    expect(spec.run).toHaveBeenCalledTimes(1);
  });

  it("never runs the same job twice at the same time", async () => {
    let release = () => {};
    const spec = job({ run: vi.fn(() => new Promise<string>((r) => (release = () => r("late")))) });
    clock.register("x:slow", "x", spec);
    await clock.tick(at(10));
    await clock.tick(at(10, 30));
    expect(spec.run).toHaveBeenCalledTimes(1);
    expect(clock.isRunning("x:slow")).toBe(true);
    release();
    await clock.idle();
    expect(clock.isRunning("x:slow")).toBe(false);
  });

  it("a failure is logged and notified once, not at every run", async () => {
    const spec = job({ run: vi.fn(async () => Promise.reject(new Error("exchange down"))) });
    clock.register("alerts:check", "alerts", spec);
    await clock.tick(at(10));
    await clock.idle();
    await clock.tick(at(10, 5));
    await clock.idle();
    expect(spec.run).toHaveBeenCalledTimes(2);
    expect(notes).toEqual([{ title: "Snapshot failed", body: "exchange down", level: "error" }]);
    const runs = await store.lines<RunRecord>(RUNS);
    expect(runs.map((r) => [r.kind, r.ref, r.ok, r.error])).toEqual([
      ["job", "alerts:check", false, "exchange down"],
      ["job", "alerts:check", false, "exchange down"],
    ]);
  });

  it("a run missed while the app was closed: skipped, or run once on start", async () => {
    const skip = job({ every: "daily at 08:00" });
    const once = job({ every: "daily at 08:00", catchUp: "run-once-on-start" });
    clock.register("a:skip", "a", skip);
    clock.register("a:once", "a", once);
    const yesterday = afterRun("daily at 08:00", at(8, 0, 22), true, undefined);
    await store.write(JOBS, { "a:skip": yesterday, "a:once": yesterday });
    await clock.tick(at(12));
    await clock.idle();
    expect(skip.run).not.toHaveBeenCalled();
    expect(once.run).toHaveBeenCalledWith(expect.objectContaining({ reason: "catch-up" }));
    expect((await states())["a:skip"].nextRun).toBe(new Date(at(8, 0, 24)).toISOString());
  });

  it("a request to run now can come from another process", async () => {
    const spec = job({ every: "daily at 08:00" });
    clock.register("cal:refresh", "cal", spec);
    await clock.tick(at(7));
    expect(spec.run).not.toHaveBeenCalled();
    await new Clock(deps()).trigger("cal:refresh");
    await clock.tick(at(7, 1));
    await clock.idle();
    expect(spec.run).toHaveBeenCalledWith(expect.objectContaining({ reason: "manual" }));
    expect(await store.read(`triggers.json`, null)).toEqual([]);
  });

  it("stopping aborts what runs; an unregistered job no longer runs", async () => {
    let seen: AbortSignal | undefined;
    const spec = job({ run: vi.fn(({ signal }) => new Promise<string>((_r, reject) => ((seen = signal), signal.addEventListener("abort", () => reject(new Error("aborted")))))) });
    const unregister = clock.register("x:long", "x", spec);
    await clock.tick(at(10));
    clock.stop();
    expect(seen?.aborted).toBe(true);
    await clock.idle();
    /* Aborted by the stop, not failed: nothing recorded, nothing said. */
    expect(notes).toEqual([]);
    expect(await store.lines(RUNS)).toEqual([]);
    unregister();
    expect(clock.list()).toEqual([]);
  });
});

describe("the core clock — sources, failures, back-off", () => {
  it("a source is read at every tick; a paused job runs only when asked", async () => {
    const run = vi.fn(async () => "ran");
    let paused = false;
    clock.source("scheduler", async () => [{ id: "task:t1", title: "Brief", every: "every 1 hour", paused, run }]);
    await clock.tick(at(10));
    await clock.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect((await states())["scheduler:task:t1"]).toMatchObject({ lastStatus: "ok", lastMessage: "ran" });
    paused = true;
    await clock.tick(at(11, 1));
    await clock.idle();
    expect(run).toHaveBeenCalledTimes(1);
    await clock.trigger("scheduler:task:t1");
    await clock.tick(at(11, 2));
    await clock.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a JobFailure is marked failed, with no second record or notice from the clock", async () => {
    const spec = job({ run: vi.fn(async () => Promise.reject(new JobFailure("no key"))) });
    clock.register("scheduler:task:t1", "scheduler", spec);
    await clock.tick(at(10));
    await clock.idle();
    expect((await states())["scheduler:task:t1"]).toMatchObject({ lastStatus: "failed", lastMessage: "no key", nextRun: new Date(at(10, 5)).toISOString() });
    expect(notes).toEqual([]);
    expect(await store.lines(RUNS)).toEqual([]);
  });

  it("a run that breaks outside its own handling waits instead of being relaunched at every tick", async () => {
    const spec = job({ every: "every 1 minute", run: vi.fn(async () => "ok") });
    /* The state cannot be written: the run succeeds, its settling throws. */
    const refusing = { ...store, update: (name: string, fallback: unknown, change: (c: unknown) => unknown) => (name === JOBS ? Promise.reject(new Error("disk full")) : store.update(name, fallback, change)) } as PluginStore;
    const fragile = new Clock({ ...deps(), store: refusing });
    fragile.register("x:fragile", "x", spec);
    for (let i = 0; i <= 4; i++) {
      await fragile.tick(at(10, 0) + i * 15_000);
      await fragile.idle();
    }
    expect(spec.run).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toMatch(/x:fragile/);
  });

  it("a tick that rejects is logged, never an unhandled rejection", async () => {
    vi.useFakeTimers();
    try {
      const failing = new Clock({ ...deps(), session: () => SESSION, store: { ...store, update: () => Promise.reject(new Error("disk busy")) } as PluginStore });
      failing.start();
      await vi.advanceTimersByTimeAsync(15_000);
      failing.stop();
      expect(logs.some((l) => /tick failed: disk busy/.test(l))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unregistering a job cancels its run in progress: nothing is recorded for it", async () => {
    const spec = job({ run: vi.fn(({ signal }) => new Promise<string>((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) });
    const unregister = clock.register("x:long", "x", spec);
    await clock.tick(at(10));
    unregister();
    await clock.idle();
    expect(notes).toEqual([]);
    expect(await store.lines<RunRecord>(RUNS)).toEqual([]);
  });
});
