import { describe, expect, it } from "vitest";
import { addDays, byDay, dayKey, eventDay, monthGrid, nextBusyDay, periodDays, startOfWeek } from "./days";
import type { CalendarEvent } from "./events";

const ev = (id: string, startsAt: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  startsAt,
  allDay: false,
  category: "macro",
  title: id,
  assets: [],
  importance: 1,
  source: "s",
  url: "https://example.com",
  fetchedAt: "",
  ...over,
});

describe("calendar days", () => {
  const wed = new Date(2026, 8, 23, 15, 30);

  it("weeks start on Monday; a month shows six of them", () => {
    expect(startOfWeek(wed)).toEqual(new Date(2026, 8, 21));
    expect(startOfWeek(new Date(2026, 8, 27))).toEqual(new Date(2026, 8, 21));
    const grid = monthGrid(new Date(2026, 8, 1));
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual(new Date(2026, 7, 31));
    expect(grid[41]).toEqual(new Date(2026, 9, 11));
  });

  it("a period is a day, this week or this month", () => {
    expect(periodDays({ kind: "day", day: wed }, wed)).toEqual([new Date(2026, 8, 23)]);
    const week = periodDays({ kind: "week" }, wed);
    expect([week[0], week[6]]).toEqual([new Date(2026, 8, 21), new Date(2026, 8, 27)]);
    const month = periodDays({ kind: "month" }, wed);
    expect(month).toHaveLength(30);
    expect(month[29]).toEqual(new Date(2026, 8, 30));
    expect(periodDays({ kind: "month" }, new Date(2028, 1, 10))).toHaveLength(29);
  });

  it("an all-day event keeps its date; events of a day are ordered", () => {
    expect(eventDay(ev("a", "2026-09-25T00:00:00.000Z", { allDay: true }))).toEqual(new Date(2026, 8, 25));
    const at = (h: number) => new Date(2026, 8, 24, h).toISOString();
    const map = byDay([ev("late", at(18)), ev("allday", "2026-09-24T00:00:00.000Z", { allDay: true }), ev("minor", at(9)), ev("major", at(9), { importance: 3 })]);
    expect(map.get(dayKey(new Date(2026, 8, 24)))!.map((e) => e.id)).toEqual(["allday", "major", "minor", "late"]);
    expect(addDays(new Date(2026, 9, 25), 7)).toEqual(new Date(2026, 10, 1));
  });

  it("an empty day points to the next busy one", () => {
    const at = (m: number, d: number) => new Date(2026, m, d, 10).toISOString();
    const days = byDay([ev("oct", at(9, 2)), ev("past", at(8, 20)), ev("fri", at(8, 25)), ev("today", at(8, 23))]);
    expect(nextBusyDay(days, wed)).toEqual(new Date(2026, 8, 25));
    expect(nextBusyDay(days, new Date(2026, 8, 25))).toEqual(new Date(2026, 9, 2));
    expect(nextBusyDay(days, new Date(2026, 9, 2))).toBeNull();
  });
});
