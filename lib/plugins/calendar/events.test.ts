import { describe, expect, it } from "vitest";
import { absorb, collectorPrompt, parseCollected } from "./collect";
import { calendarPrompt, eventKey, eventLine, mergeEvents, prune, searchEvents, validateEvent, type CalendarEvent } from "./events";
import { expiries } from "./expiries";

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
  });

  it("two collections of the same event give one event, updated", () => {
    const first = mergeEvents([], [ok()], now);
    expect(first).toMatchObject({ added: 1, updated: 0 });
    const again = mergeEvents(first.events, [ok({ title: "FOMC rate decision (updated)", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" })], now);
    expect(again).toMatchObject({ added: 0, updated: 1 });
    expect(again.events).toHaveLength(1);
    expect(again.events[0].title).toBe("FOMC rate decision (updated)");
    expect(mergeEvents(again.events, [ok({ id: "fed-2026-10" })], now).events).toHaveLength(1);
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
    expect(eventLine(events[0])).toBe("2026-10-29 18:00 UTC — FOMC rate decision · Macro, importance 3 · source: Federal Reserve https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (collected 2026-09-23)");
  });
});

describe("calendar prompt", () => {
  it("the important events of the next 48 hours, three at most", () => {
    const soon = (h: number, importance: number, title: string) => ok({ startsAt: new Date(now.getTime() + h * 3600_000).toISOString(), importance, title });
    const events = [soon(1, 3, "CPI"), soon(5, 2, "Minor"), soon(10, 3, "FOMC"), soon(20, 3, "Unlock"), soon(30, 3, "Fourth"), soon(60, 3, "Later")];
    const p = calendarPrompt(events, now);
    expect(p.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.split(" — ")[1].split(" ·")[0])).toEqual(["CPI", "FOMC", "Unlock"]);
    expect(calendarPrompt([soon(5, 2, "Minor")], now)).toBe("");
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
    expect(list.filter((e) => e.id.startsWith("cme")).map((e) => [e.id, e.allDay, e.importance])).toEqual([
      ["cme-2026-09", true, 3],
      ["cme-2026-10", true, 2],
    ]);
  });
});

describe("collection", () => {
  it("asks for sourced events in a JSON list, leaves the expiries out", () => {
    const p = collectorPrompt(new Date("2026-09-23T00:00:00Z"), new Date("2026-09-30T00:00:00Z"), ["BTC", "SOL"]);
    expect(p).toMatch(/between 2026-09-23 and 2026-09-30/);
    expect(p).toMatch(/concerning: BTC, SOL/);
    expect(p).toMatch(/Leave out options and futures expiries/);
    expect(p).toMatch(/skip anything you cannot source/);
  });

  it("reads the last JSON block, or says there is none", () => {
    expect(parseCollected('Found these.\n```json\n[{"a":1}]\n```\nand\n```json\n[{"b":2}]\n```')).toEqual([{ b: 2 }]);
    expect(parseCollected('Here: [{"a": 1}] done')).toEqual([{ a: 1 }]);
    expect(parseCollected("Nothing found.")).toEqual({ error: "The collector's answer holds no JSON list of events." });
  });

  it("absorbs: sourced events in, the rest rejected with the reason", () => {
    const r = absorb([], [raw(), raw({ url: "", title: "Rumoured listing" }), raw({ category: "expiry", title: "BTC expiry" }), "junk"], now);
    expect(r.events.map((e) => e.title)).toEqual(["FOMC rate decision"]);
    expect(r.rejected).toEqual(['no source URL: "Rumoured listing"', 'expiries are computed, not collected: "BTC expiry"', "not an object"]);
  });
});
