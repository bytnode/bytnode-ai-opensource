import { expiries } from "@/lib/plugins/calendar/expiries";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";

/* ---------------------------------------------------------------------------
   What the three calendar designs share: local dates (weeks start on
   Monday), events grouped by day, and a sample week for the review.

   The sample is labelled as such on screen: it only exists to judge how
   each design holds a busy month. The live data comes from the calendar
   plugin.
--------------------------------------------------------------------------- */

export const DAY = 24 * 3600_000;

/** The interface speaks English: dates too (day before month, 24 h clock). */
export const LOCALE = "en-GB";

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Monday of the week of `d`. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** The 42 days a month view shows: from the Monday before the 1st. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The local day an event belongs to: an all-day event keeps its date. */
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

export const timeOf = (e: CalendarEvent) => new Date(e.startsAt).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** The title a grid cell has room for: the computed expiries are named
    short there, in full in the card. */
export function shortTitle(e: CalendarEvent): string {
  if (!e.computed) return e.title;
  if (e.id.startsWith("cme")) return "CME futures expiry";
  return `Deribit ${e.importance === 3 ? "quarterly" : e.importance === 2 ? "monthly" : "weekly"} expiry`;
}

/** Minutes since local midnight. */
export const minutesOf = (e: CalendarEvent) => {
  const d = new Date(e.startsAt);
  return d.getHours() * 60 + d.getMinutes();
};

export const CATEGORY_TONE: Record<Category, string> = {
  macro: "var(--cal-macro)",
  unlock: "var(--cal-unlock)",
  listing: "var(--cal-listing)",
  expiry: "var(--cal-expiry)",
  upgrade: "var(--cal-upgrade)",
  project: "var(--cal-project)",
};

/* --- The review's sample ---------------------------------------------------- */

type Sample = [dayOffset: number, utc: string | null, category: Category, title: string, importance: 1 | 2 | 3, assets?: string[]];

const SAMPLE: Sample[] = [
  [-6, null, "project", "Governance vote closes", 1, ["UNI"]],
  [-3, "12:30", "macro", "US producer prices (PPI)", 2],
  [-1, "08:00", "macro", "UK inflation (CPI)", 1],
  [0, "14:00", "macro", "Fed chair testimony", 2],
  [1, "12:30", "macro", "US inflation (CPI)", 3],
  [1, "12:30", "macro", "Weekly jobless claims", 1],
  [3, "07:15", "macro", "Eurozone PMI", 1],
  [3, "13:45", "macro", "US PMI", 1],
  [5, null, "unlock", "ARB token unlock", 2, ["ARB"]],
  [6, "18:00", "macro", "FOMC rate decision", 3],
  [6, "18:30", "macro", "FOMC press conference", 2],
  [8, "12:15", "macro", "ECB rate decision", 3],
  [9, null, "listing", "New perpetual listing", 1, ["TIA"]],
  [12, null, "upgrade", "Network upgrade on testnet", 2, ["ETH"]],
  [14, "12:30", "macro", "US jobs report (NFP)", 3],
  [16, null, "unlock", "SUI token unlock", 2, ["SUI"]],
  [20, "12:30", "macro", "US GDP, first estimate", 2],
  [23, null, "project", "Mainnet launch", 1, ["SEI"]],
  [27, "18:00", "macro", "FOMC minutes", 2],
];

/** The sample events around `today`, plus the computed expiries. */
export function sampleEvents(today: Date): CalendarEvent[] {
  const made = SAMPLE.map(([offset, utc, category, title, importance, assets = []], i): CalendarEvent => {
    const d = addDays(today, offset);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      id: `sample-${i}`,
      startsAt: utc ? `${day}T${utc}:00.000Z` : `${day}T00:00:00.000Z`,
      allDay: utc === null,
      category,
      title,
      assets,
      importance,
      source: "Sample data",
      url: "",
      fetchedAt: today.toISOString(),
    };
  });
  return [...made, ...expiries(addDays(today, -40), addDays(today, 70), today)];
}
