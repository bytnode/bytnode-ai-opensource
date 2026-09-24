import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import type { NotificationInput, Session } from "../core/contract";
import { pluginStore, type PluginStore } from "../core/store";
import { Clock, JOBS, RUNS, TASKS, type ClockDeps } from "./engine";
import type { JobSpec } from "./service";
import { afterRun, taskKey, type AgentTask, type RunRecord, type RunState } from "./tasks";

const at = (h: number, m = 0, d = 23) => new Date(2026, 8, d, h, m).getTime();
const SESSION = { agents: [{ id: "a1", name: "Analyst" }] as AgentConfig[] } as Session;

let root: string;
let store: PluginStore;
let session: Session | null;
let notes: NotificationInput[];
let runAgent: ReturnType<typeof vi.fn<ClockDeps["runAgent"]>>;
let clock: Clock;

const deps = (): ClockDeps => ({ store, session: () => session, notify: async (n) => void notes.push(n), runAgent, log: () => {} });
const states = () => store.read<Record<string, RunState>>(JOBS, {});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-clock-"));
  store = pluginStore("scheduler", root);
  session = SESSION;
  notes = [];
  runAgent = vi.fn<ClockDeps["runAgent"]>(async () => ({ ok: true, text: "## Brief\nBTC is up 2 %." }));
  clock = new Clock(deps());
});

afterEach(async () => {
  clock.stop();
  await clock.idle();
  await fs.rm(root, { recursive: true, force: true });
});

const job = (over: Partial<JobSpec> = {}): JobSpec => ({ id: "snap", title: "Snapshot", every: "every 5 minutes", run: vi.fn(async () => "done"), ...over });

describe("scheduler clock — jobs", () => {
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

describe("scheduler clock — agent tasks", () => {
  const task = (over: Partial<AgentTask> = {}): AgentTask => ({ id: "t1", title: "Morning brief", prompt: "Brief me.", agent: "Analyst", frequency: "every 1 hour", catchUp: "skip", status: "active", createdAt: "", ...over });

  it("runs the agent, logs the report and announces it as a conversation", async () => {
    await store.write(TASKS, [task()]);
    await clock.tick(at(10));
    await clock.idle();
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "Analyst", prompt: "Brief me.", purpose: 'scheduled task "Morning brief", every 1 hour' }), SESSION);
    const [run] = await store.lines<RunRecord>(RUNS);
    expect(run).toMatchObject({ kind: "task", ref: "t1", agentId: "a1", ok: true, text: "## Brief\nBTC is up 2 %.", prompt: "Brief me." });
    expect(notes).toEqual([{ title: "Scheduled task: Morning brief", body: "Brief", level: "success", action: { kind: "open-conversation", conversationId: `run-${run.id}` } }]);
    expect((await states())[taskKey("t1")]).toMatchObject({ lastStatus: "ok" });
  });

  it("a paused task waits, unless asked to run now; a failure says why", async () => {
    runAgent.mockResolvedValueOnce({ ok: false, error: "No OpenRouter key: this agent cannot run." });
    await store.write(TASKS, [task({ status: "paused" })]);
    await clock.tick(at(10));
    await clock.idle();
    expect(runAgent).not.toHaveBeenCalled();
    await clock.trigger(taskKey("t1"));
    await clock.tick(at(10, 1));
    await clock.idle();
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(notes[0]).toMatchObject({ title: "Scheduled task failed: Morning brief", body: "No OpenRouter key: this agent cannot run.", level: "error", action: { kind: "open-view" } });
    expect((await store.lines<RunRecord>(RUNS))[0]).toMatchObject({ ok: false, error: "No OpenRouter key: this agent cannot run." });
  });
});
