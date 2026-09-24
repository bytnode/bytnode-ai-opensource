import { describe, expect, it } from "vitest";
import { editCalendar } from "./edit";
import { calendarPrompt, eventKey, eventLine, mergeEvents, prune, searchEvents, validateEvent, type CalendarEvent } from "./events";
import { expiries, londonFourPm } from "./expiries";

const now = new Date("2026-09-23T10:00:00Z");
const raw = (over: Record<string, unknown> = {}) => ({ startsAt: "2026-10-29T18:00:00Z", category: "macro", title: "FOMC rate decision", assets: [], importance: 3, source: "Federal Reserve", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", ...over });
const ok = (over: Record<string, unknown> = {}) => validateEvent(raw(over), now) as CalendarEvent;

describe("calendar events", () => {
  it("keeps a sourced event, rejects one without a source URL, a date or a known category", () => {
    expect(ok()).toMatchObject({ startsAt: "2026-10-29T18:00:00.000Z", allDay: false, importance: 3, source: "Federal Reserve", fetchedAt: now.toISOString() });
    expect(validateEvent(raw({ url: "" }), now)).toEqual({ error: 'no source URL: "FOMC rate decision"' });
    expect(validateEvent(raw({ url: "javascript:alert(1)" }), now)).toMatchObject({ error: expect.stringMatching(/^no source URL/) });
    expect(validateEvent(raw({ startsAt: "soon" }), now)).toMatchObject({ error: expect.stringMatching(/^no valid date/) });
    expect(validateEvent(raw({ category: "rumour" }), now)).toMatchObject({ error: expect.stringMatching(/^unknown category/) });
    expect(ok({ assets: ["btc", "ETH/USDT", "<b>", "btc"], source: "" })).toMatchObject({ assets: ["BTC", "ETH"], source: "www.federalreserve.gov" });
    expect(validateEvent(raw({ category: "expiry", title: "BTC expiry" }), now)).toEqual({ error: 'expiries are computed, not written: "BTC expiry"' });
    expect(validateEvent(raw({ category: "scheduled", title: "Brief" }), now)).toEqual({ error: 'scheduled runs are computed, not written: "Brief"' });
  });

  it("a task needs no source: the agent that wrote it stands for one", () => {
    const task = validateEvent({ startsAt: "2026-09-25T09:00:00Z", category: "task", title: "Review the BTC position", notes: "  Check the stop  ", done: true }, now, "Analyst");
    expect(task).toMatchObject({ category: "task", url: "", source: "Analyst", notes: "Check the stop", done: true });
    expect(validateEvent({ startsAt: "2026-09-25T09:00:00Z", category: "task", title: "Bad link", url: "ftp://x" }, now)).toEqual({ error: 'no source URL: "Bad link"' });
    /* `done` means something for a task only. */
    expect(ok({ done: true })).not.toHaveProperty("done");
  });

  it("the same event written twice gives one event, updated", () => {
    const first = mergeEvents([], [ok()], now);
    expect([first.added.length, first.updated.length]).toEqual([1, 0]);
    const again = mergeEvents(first.events, [ok({ title: "FOMC rate decision (updated)", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" })], now);
    expect([again.added.length, again.updated.length]).toEqual([0, 1]);
    expect(again.events).toHaveLength(1);
    expect(again.events[0].title).toBe("FOMC rate decision (updated)");
    expect(mergeEvents(again.events, [ok()], now).events).toHaveLength(1);
    /* Two tasks without a URL are not the same for it. */
    const task = (title: string) => validateEvent({ startsAt: "2026-10-29T09:00:00Z", category: "task", title }, now) as CalendarEvent;
    expect(mergeEvents([], [task("One"), task("Two")], now).events).toHaveLength(2);
    expect(eventKey("2026-10-29", "FOMC  Rate decision!")).toBe(eventKey("2026-10-29", "fomc rate decision"));
  });

  it("keeps 30 days of past events and the whole future", () => {
    const old = ok({ startsAt: "2026-08-01T00:00:00Z", title: "old" });
    const recent = ok({ startsAt: "2026-09-01T00:00:00Z", title: "recent" });
    expect(prune([old, recent, ok()], now).map((e) => e.title)).toEqual(["recent", "FOMC rate decision"]);
  });

  it("searches by period, category, asset, importance and text", () => {
    const events = [ok(), ok({ startsAt: "2026-10-01T00:00:00Z", category: "unlock", title: "ARB unlock", assets: ["ARB"], importance: 2 }), ok({ startsAt: "2026-10-02T00:00:00Z", category: "listing", title: "SOL listing", assets: ["SOL"], importance: 1 })];
    const all = { from: now, to: new Date("2026-12-31T00:00:00Z") };
    expect(searchEvents(events, all).map((e) => e.title)).toEqual(["ARB unlock", "SOL listing", "FOMC rate decision"]);
    expect(searchEvents(events, { ...all, assets: ["ARB/USDT"] }).map((e) => e.title)).toEqual(["ARB unlock", "FOMC rate decision"]);
    expect(searchEvents(events, { ...all, minImportance: 2, categories: ["unlock"] }).map((e) => e.title)).toEqual(["ARB unlock"]);
    expect(searchEvents(events, { ...all, text: "sol" }).map((e) => e.title)).toEqual(["SOL listing"]);
    expect(searchEvents(events, { from: now, to: new Date("2026-10-01T12:00:00Z") }).map((e) => e.title)).toEqual(["ARB unlock"]);
    expect(eventLine(events[0])).toBe(`2026-10-29 18:00 UTC — FOMC rate decision · Macro, importance 3 · source: Federal Reserve https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (id ${events[0].id}, written 2026-09-23)`);
  });
});

describe("calendar prompt", () => {
  const soon = (h: number, importance: number, title: string, over: Record<string, unknown> = {}) => ok({ startsAt: new Date(now.getTime() + h * 3600_000).toISOString(), importance, title, ...over });
  const titles = (p: string) => p.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.split(" — ")[1].split(" ·")[0]);

  it("the important events of the next 48 hours, three at most", () => {
    const events = [soon(1, 3, "CPI"), soon(5, 2, "Minor"), soon(10, 3, "FOMC"), soon(20, 3, "Unlock"), soon(30, 3, "Fourth"), soon(60, 3, "Later")];
    expect(titles(calendarPrompt(events, now))).toEqual(["CPI", "FOMC", "Unlock"]);
    expect(calendarPrompt([soon(5, 2, "Minor")], now)).toBe("");
  });

  it("and the user's open tasks due by then", () => {
    const task = (h: number, title: string, done = false) => soon(h, 1, title, { category: "task", url: "", source: "", done });
    const p = calendarPrompt([soon(1, 3, "CPI"), task(3, "Review BTC"), task(4, "Done already", true), task(70, "Next week")], now);
    expect(p).toMatch(/## Market events in the next 48 hours\n- .*CPI/);
    expect(p).toMatch(/## The user's tasks in the next 48 hours\n- .*Review BTC · Task · source: an agent \(id/);
    expect(titles(p)).toEqual(["CPI", "Review BTC"]);
    expect(p).toMatch(/CalendarEdit writes to the calendar\.$/);
  });
});

describe("expiries", () => {
  it("Deribit every Friday at 08:00 UTC, monthly and quarterly on the last Friday; CME monthly", () => {
    const list = expiries(new Date("2026-09-21T00:00:00Z"), new Date("2026-10-31T00:00:00Z"), now);
    const deribit = list.filter((e) => e.id.startsWith("deribit"));
    expect(deribit.map((e) => [e.startsAt, e.importance])).toEqual([
      ["2026-09-25T08:00:00.000Z", 3],
      ["2026-10-02T08:00:00.000Z", 1],
      ["2026-10-09T08:00:00.000Z", 1],
      ["2026-10-16T08:00:00.000Z", 1],
      ["2026-10-23T08:00:00.000Z", 1],
      ["2026-10-30T08:00:00.000Z", 2],
    ]);
    expect(deribit[0].title).toBe("Deribit BTC & ETH quarterly options and futures expiry");
    /* Marked as computed, never passed off as written. */
    expect(list.every((e) => e.computed === true)).toBe(true);
    expect(eventLine(deribit[0])).toMatch(/\(computed, not editable\)$/);
    /* 4 pm London: 15:00 UTC in British Summer Time, 16:00 UTC after the
       last Sunday of October (the 25th in 2026). */
    expect(list.filter((e) => e.id.startsWith("cme")).map((e) => [e.id, e.startsAt, e.allDay, e.importance])).toEqual([
      ["cme-2026-09", "2026-09-25T15:00:00.000Z", false, 3],
      ["cme-2026-10", "2026-10-30T16:00:00.000Z", false, 2],
    ]);
    expect(londonFourPm(2026, 2, 27).toISOString()).toBe("2026-03-27T16:00:00.000Z");
    expect(londonFourPm(2026, 3, 24).toISOString()).toBe("2026-04-24T15:00:00.000Z");
  });
});

describe("editing the calendar", () => {
  const author = { name: "Analyst", agentId: "a1" };
  const task = { startsAt: "2026-09-25T09:00:00Z", category: "task", title: "Review the BTC position" };

  it("adds, checks, and never duplicates", () => {
    const r = editCalendar([], { add: [raw(), task, raw({ url: "", title: "Rumoured listing" }), raw({ category: "expiry", title: "BTC expiry" }), raw({ startsAt: "2026-07-01T00:00:00Z", title: "Long ago" })] }, now, author);
    expect(r.added.map((e) => e.title)).toEqual(["FOMC rate decision", "Review the BTC position"]);
    expect(r.added.every((e) => e.by === "a1")).toBe(true);
    expect(r.added[1]).toMatchObject({ source: "Analyst", url: "" });
    expect(r.rejected).toEqual(['no source URL: "Rumoured listing"', 'expiries are computed, not written: "BTC expiry"', 'more than 30 days in the past: "Long ago"']);
    const again = editCalendar(r.events, { add: [task] }, now, author);
    expect([again.added.length, again.updated.length, again.events.length]).toEqual([0, 1, 2]);
  });

  it("changes an entry under its id, ticks a task off, removes", () => {
    const { events } = editCalendar([], { add: [task, raw()] }, now, author);
    const id = events.find((e) => e.category === "task")!.id;
    const done = editCalendar(events, { update: [{ id, done: true, notes: "Stop moved to 58k" }] }, now, { name: "Other" });
    expect(done.updated).toEqual([expect.objectContaining({ id, done: true, notes: "Stop moved to 58k", source: "Analyst", by: "a1" })]);
    expect(editCalendar(done.events, { update: [{ id, done: false }] }, now, author).updated[0]).not.toHaveProperty("done");
    /* A change is checked again: a market event keeps its source. */
    const fomc = events.find((e) => e.category === "macro")!.id;
    expect(editCalendar(events, { update: [{ id: fomc, url: "" }] }, now, author).rejected).toEqual(['no source URL: "FOMC rate decision"']);
    const gone = editCalendar(done.events, { remove: [id, "deribit-2026-09-25"] }, now, author);
    expect(gone.removed.map((e) => e.title)).toEqual(["Review the BTC position"]);
    expect(gone.events.map((e) => e.title)).toEqual(["FOMC rate decision"]);
    expect(gone.rejected).toEqual(['no entry "deribit-2026-09-25" to remove']);
  });
});
