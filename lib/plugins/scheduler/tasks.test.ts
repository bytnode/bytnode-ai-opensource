import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { afterRun, backgroundFrame, changeTask, decide, findAgent, findTask, newTask, plannedRuns, readTelegram, setTaskTelegram, shortDate, taskKey, taskLines, telegramText, type AgentTask, type RunState } from "./tasks";

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

  it("catch-up 'skip' also holds for a task that never ran: its first time, missed while closed, is skipped", () => {
    /* Created at 20:00 for "daily at 08:00"; the app reopens at 14:00 the day after. */
    const first = decide("daily at 08:00", {}, at(20, 0, 22), opts) as { state: RunState };
    expect(decide("daily at 08:00", first.state, at(14), { ...opts, resumed: true })).toMatchObject({ run: false, state: { nextRun: new Date(at(8, 0, 24)).toISOString() } });
    expect(decide("daily at 08:00", first.state, at(14), { ...opts, resumed: true, catchUp: "run-once-on-start" })).toEqual({ run: true, reason: "catch-up" });
    /* An interval task planned a moment ago still runs at the first (resumed) tick. */
    const fresh = decide("every 30 minutes", {}, at(10), opts);
    expect(fresh).toEqual({ run: true, reason: "schedule" });
    expect(decide("every 30 minutes", { nextRun: new Date(at(10)).toISOString(), every: "every 30 minutes" }, at(10, 1), { ...opts, resumed: true })).toEqual({ run: true, reason: "schedule" });
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

describe("plannedRuns", () => {
  const task = (id: string, frequency: string, status: AgentTask["status"] = "active"): AgentTask => ({ id, title: `Task ${id}`, prompt: "p", agent: "a1", frequency, catchUp: "skip", status, createdAt: "2026-09-01T00:00:00Z" });
  const name = (ref: string) => (ref === "a1" ? "Analyst" : ref);

  it("the coming runs of the active tasks, from now on, in order", () => {
    const tasks = [task("m", "daily at 08:00"), task("w", "every friday at 18:30"), task("p", "daily at 09:00", "paused"), task("x", "sometimes")];
    const runs = plannedRuns(tasks, {}, at(0), at(0, 0, 27), at(10), name);
    expect(runs.map((r) => [r.taskId, r.at])).toEqual([
      ["w", new Date(at(18, 30, 25)).toISOString()],
      ["m", new Date(at(8, 0, 24)).toISOString()],
      ["m", new Date(at(8, 0, 25)).toISOString()],
      ["m", new Date(at(8, 0, 26)).toISOString()],
    ].sort((a, b) => a[1].localeCompare(b[1])));
    expect(runs[0]).toMatchObject({ agent: "Analyst", title: expect.stringMatching(/^Task /), allDay: false });
  });

  it("an interval counts from its known next run; more often than hourly, one entry a day", () => {
    const states: Record<string, RunState> = { [taskKey("h")]: { nextRun: new Date(at(10, 30)).toISOString(), every: "every 4 hours" } };
    const hours = plannedRuns([task("h", "every 4 hours")], states, at(0), at(23, 59), at(10), name).map((r) => r.at);
    expect(hours).toEqual([at(10, 30), at(14, 30), at(18, 30), at(22, 30)].map((t) => new Date(t).toISOString()));
    const often = plannedRuns([task("q", "every 15 minutes")], {}, at(0), at(12, 0, 25), at(10), name);
    expect(often.map((r) => [r.at, r.allDay])).toEqual([["2026-09-23T00:00:00.000Z", true], ["2026-09-24T00:00:00.000Z", true], ["2026-09-25T00:00:00.000Z", true]]);
  });
});

describe("a task's Telegram destination", () => {
  const base = { title: "Brief", prompt: "Do it", agent: "a1", frequency: "daily at 08:00" };
  it("is kept when asked, with its report length (full by default)", () => {
    const t = newTask({ ...base, telegramBot: "t1" }, "x", new Date());
    expect("error" in t ? null : t.telegram).toEqual({ bot: "t1", report: "full" });
    const s = newTask({ ...base, telegramBot: "t1", report: "short" }, "x", new Date());
    expect("error" in s ? null : s.telegram).toEqual({ bot: "t1", report: "short" });
    const none = newTask({ ...base, telegramBot: " " }, "x", new Date());
    expect("error" in none ? null : none.telegram).toBeUndefined();
    expect(readTelegram({})).toBeUndefined();
  });
  it("can be changed or removed on a task", () => {
    const t = newTask(base, "x", new Date()) as AgentTask;
    const on = setTaskTelegram([t], "x", { bot: "t1", report: "short" });
    expect("error" in on ? null : on.task.telegram).toEqual({ bot: "t1", report: "short" });
    const off = setTaskTelegram("error" in on ? [] : on.tasks, "x", undefined);
    expect("error" in off ? "x" : off.task.telegram).toBeUndefined();
    expect(setTaskTelegram([t], "nope", undefined)).toHaveProperty("error");
  });
  it("sends the title and the report — whole or its start — or why it failed", () => {
    const long = "First finding. " + "Detail. ".repeat(200);
    expect(telegramText({ title: "Brief", telegram: { bot: "t1", report: "full" } }, { ok: true, text: long })).toBe(`🗓 Brief

${long}`);
    const short = telegramText({ title: "Brief", telegram: { bot: "t1", report: "short" } }, { ok: true, text: long });
    expect(short.length).toBeLessThan(long.length);
    expect(short).toMatch(/Full report in BytNode-AI\]$/);
    expect(telegramText({ title: "Brief" }, { ok: false, error: "No agent" })).toBe("⚠️ Scheduled task failed: Brief\n\nNo agent");
  });
});
