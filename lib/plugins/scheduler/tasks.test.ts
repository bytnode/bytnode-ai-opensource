import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { afterRun, backgroundFrame, changeTask, decide, findAgent, findTask, newTask, shortDate, taskKey, taskLines, type AgentTask, type RunState } from "./tasks";

const at = (h: number, m = 0, d = 23) => new Date(2026, 8, d, h, m).getTime();
const opts = { resumed: false, catchUp: "skip" as const, triggered: false };

describe("decide", () => {
  it("an interval job runs at once, then one step after each run", () => {
    expect(decide("every 5 minutes", {}, at(10), opts)).toEqual({ run: true, reason: "schedule" });
    const state = afterRun("every 5 minutes", at(10), true, "ok");
    expect(decide("every 5 minutes", state, at(10, 4), opts)).toEqual({ run: false, state });
    expect(decide("every 5 minutes", state, at(10, 5), opts)).toEqual({ run: true, reason: "schedule" });
  });

  it("a time of day waits for its time, and remembers it", () => {
    const d = decide("daily at 08:00", {}, at(7), opts);
    expect(d).toEqual({ run: false, state: { nextRun: new Date(at(8)).toISOString(), every: "daily at 08:00" } });
    const state = (d as { state: RunState }).state;
    expect(decide("daily at 08:00", state, at(8), opts)).toEqual({ run: true, reason: "schedule" });
  });

  it("a changed frequency is computed again", () => {
    const state = afterRun("daily at 08:00", at(8), true, undefined);
    expect(decide("daily at 09:00", state, at(8, 30), opts)).toEqual({ run: false, state: { ...state, nextRun: new Date(at(9)).toISOString(), every: "daily at 09:00" } });
  });

  it("a run missed while the app was closed: skipped by default, or run once", () => {
    const state = afterRun("daily at 08:00", at(8, 0, 21), true, undefined);
    const skipped = decide("daily at 08:00", state, at(10), { ...opts, resumed: true });
    expect(skipped).toMatchObject({ run: false, state: { nextRun: new Date(at(8, 0, 24)).toISOString() } });
    expect(decide("daily at 08:00", state, at(10), { ...opts, resumed: true, catchUp: "run-once-on-start" })).toEqual({ run: true, reason: "catch-up" });
  });

  it("a request runs now; a bad frequency says why", () => {
    expect(decide("daily at 08:00", {}, at(7), { ...opts, triggered: true })).toEqual({ run: true, reason: "manual" });
    expect(decide("sometimes", {}, at(7), opts)).toMatchObject({ error: expect.stringMatching(/Unreadable frequency/) });
  });

  it("records the outcome of a run", () => {
    expect(afterRun("every hour", at(10), false, "x".repeat(600))).toMatchObject({ lastStatus: "failed", nextRun: new Date(at(11)).toISOString() });
    expect(afterRun("every hour", at(10), false, "x".repeat(600)).lastMessage).toHaveLength(500);
  });
});

describe("newTask", () => {
  const now = new Date("2026-09-23T10:00:00Z");
  it("builds a task, or says what is missing", () => {
    expect(newTask({ title: " Brief ", prompt: "Market brief", agent: "a1", frequency: "daily at 08:00" }, "t1", now)).toEqual({
      id: "t1",
      title: "Brief",
      prompt: "Market brief",
      agent: "a1",
      frequency: "daily at 08:00",
      catchUp: "skip",
      status: "active",
      createdAt: now.toISOString(),
    });
    expect(newTask({ prompt: "x", agent: "a", frequency: "every hour" }, "t", now)).toEqual({ error: "Give the task a title." });
    expect(newTask({ title: "x", prompt: "x", agent: "a", frequency: "every 5 minutes" }, "t", now)).toMatchObject({ error: expect.stringMatching(/every 15 minutes/) });
    expect(newTask({ title: "x", prompt: "x", agent: "a", frequency: "whenever" }, "t", now)).toMatchObject({ error: expect.stringMatching(/Unreadable/) });
  });

  it("frames a background run: nobody to ask, no order", () => {
    const frame = backgroundFrame("scheduled task: brief", now);
    expect(frame).toMatch(/Nobody can answer/);
    expect(frame).toMatch(/cannot place, cancel or close an order/);
  });
});

describe("tasks", () => {
  const task = (id: string, title: string, status: AgentTask["status"] = "active"): AgentTask => ({ id, title, prompt: "p", agent: "a1", frequency: "daily at 08:00", catchUp: "skip", status, createdAt: "" });
  const list = [task("t1", "Morning brief"), task("t2", "Funding watch", "paused")];

  it("finds a task by id or title, an agent by id or name", () => {
    expect(findTask(list, "t2")?.title).toBe("Funding watch");
    expect(findTask(list, " morning BRIEF ")?.id).toBe("t1");
    expect(findTask(list, "nope")).toBeUndefined();
    const agents = [{ id: "a1", name: "Analyst" }, { id: "a2", name: "Trader" }] as AgentConfig[];
    expect(findAgent(agents, "a2")?.name).toBe("Trader");
    expect(findAgent(agents, " analyst")?.id).toBe("a1");
    expect(findAgent(agents, "x")).toBeUndefined();
  });

  it("pauses, resumes, deletes", () => {
    expect(changeTask(list, "t1", "pause")).toMatchObject({ task: { id: "t1", status: "paused" } });
    expect(changeTask(list, "Funding watch", "resume")).toMatchObject({ task: { status: "active" } });
    const deleted = changeTask(list, "t1", "delete");
    expect("tasks" in deleted && deleted.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(changeTask(list, "t9", "delete")).toMatchObject({ error: expect.stringMatching(/No scheduled task "t9"/) });
  });

  it("lists them with their last and next run, in local time", () => {
    const last = new Date(2026, 8, 23, 8, 0).toISOString();
    const next = new Date(2026, 8, 24, 8, 0).toISOString();
    const lines = taskLines(list, { [taskKey("t1")]: { lastRun: last, lastStatus: "ok", nextRun: next } });
    expect(lines[0]).toBe("- Morning brief [t1] — agent a1, daily at 08:00; last 2026-09-23 08:00 (ok); next 2026-09-24 08:00");
    expect(lines[1]).toBe("- Funding watch [t2] — agent a1, daily at 08:00; never run; paused");
    expect(shortDate(undefined)).toBe("—");
  });
});
