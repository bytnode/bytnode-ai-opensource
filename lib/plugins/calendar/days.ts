import type { CalendarEvent } from "./events";

/* ---------------------------------------------------------------------------
   The calendar view's arithmetic of days, in the viewer's local time:
   weeks start on Monday, a month is shown as six weeks, a period (a day,
   this week, this month) is a list of days, and the events are grouped by
   the day they fall on. Pure, tested; the browser uses it.
--------------------------------------------------------------------------- */

export const DAY_MS = 24 * 3600_000;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Monday of the week of `d`. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** The 42 days a month shows: from the Monday before the 1st. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(firstOfMonth(month));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export type Period = { kind: "day"; day: Date } | { kind: "week" } | { kind: "month" };

/** The days a period covers: the day, this week (Monday to Sunday), or
    every day of this month. */
export function periodDays(period: Period, today: Date): Date[] {
  if (period.kind === "day") return [startOfDay(period.day)];
  if (period.kind === "week") return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i));
  const first = firstOfMonth(today);
  const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** The local day an event falls on; an all-day event keeps its date. */
export function eventDay(e: CalendarEvent): Date {
  if (e.allDay) {
    const [y, m, d] = e.startsAt.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return startOfDay(new Date(e.startsAt));
}

/** Events by local day: all-day first, then by time, the important first. */
export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = dayKey(eventDay(e));
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt) || b.importance - a.importance);
  }
  return map;
}

/** A day's events by local hour: the all-day ones apart, then one list
    per hour, 0 to 23 (in the order they come, `byDay`'s). */
export function byHour(events: CalendarEvent[]): { allDay: CalendarEvent[]; hours: CalendarEvent[][] } {
  const allDay: CalendarEvent[] = [];
  const hours: CalendarEvent[][] = Array.from({ length: 24 }, () => []);
  for (const e of events) (e.allDay ? allDay : hours[new Date(e.startsAt).getHours()]).push(e);
  return { allDay, hours };
}

/** Consecutive days grouped by week, Monday to Sunday: a month's days
    give its weeks, the first and the last often partial. */
export function weeksOf(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (const d of days) {
    const last = weeks[weeks.length - 1];
    if (last && sameDay(startOfWeek(last[0]), startOfWeek(d))) last.push(d);
    else weeks.push([d]);
  }
  return weeks;
}

/** The ISO 8601 week number: weeks start on Monday, and week 1 is the one
    that holds the year's first Thursday. */
export function isoWeek(d: Date): number {
  const thursday = addDays(startOfWeek(d), 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  return Math.floor(Math.round((thursday.getTime() - jan1.getTime()) / DAY_MS) / 7) + 1;
}

/** The first day after `day` that has an event in `days` (as `byDay`
    groups them), or null — what an empty day points to. */
export function nextBusyDay(days: Map<string, CalendarEvent[]>, day: Date): Date | null {
  let next: Date | null = null;
  for (const list of days.values()) {
    const d = eventDay(list[0]);
    if (d > startOfDay(day) && (!next || d < next)) next = d;
  }
  return next;
}
