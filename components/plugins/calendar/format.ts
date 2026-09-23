import type { CSSProperties } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { addDays, sameDay } from "@/lib/plugins/calendar/days";

/* How the calendar writes dates and paints its calendars. The interface
   speaks English: dates too — day before month, a 24-hour clock. */

export const LOCALE = "en-GB";

/** A day as the agenda names it: Today, Tomorrow, Yesterday, else its weekday. */
export function dayLabel(d: Date, today: Date): string {
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, addDays(today, 1))) return "Tomorrow";
  if (sameDay(d, addDays(today, -1))) return "Yesterday";
  return d.toLocaleDateString(LOCALE, { weekday: "long" });
}

export const timeOf = (e: CalendarEvent) => new Date(e.startsAt).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** One colour per calendar: Apple's system colours (`calendar.css`). */
export const TONE: Record<Category, string> = {
  macro: "var(--cal-macro)",
  unlock: "var(--cal-unlock)",
  listing: "var(--cal-listing)",
  expiry: "var(--cal-expiry)",
  upgrade: "var(--cal-upgrade)",
  project: "var(--cal-project)",
};

export const toneOf = (c: Category) => ({ "--tone": TONE[c] }) as CSSProperties;
