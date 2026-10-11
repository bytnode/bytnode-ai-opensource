import type { CSSProperties } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";
import { addDays, sameDay } from "@/lib/plugins/calendar/days";
import { capitalize } from "@/lib/plugins/shared/frequency-words";
import { currentMessages, dateTag } from "@/lib/i18n/store";

/* How the calendar writes dates and paints its calendars. Dates in the
   interface's language (English: day before month, a 24-hour clock), read
   at call time — from a component that reads `useMessages()`, so a change
   of language writes them again. The week starts on Monday whatever the
   language. */

/** The tag every date of the tab is written with. */
export const locale = (): string => dateTag();

/** A day as the agenda names it: Today, Tomorrow, Yesterday, else its weekday. */
export function dayLabel(d: Date, today: Date): string {
  const m = currentMessages();
  if (sameDay(d, today)) return m.common.today;
  if (sameDay(d, addDays(today, 1))) return m.calendar.tomorrow;
  if (sameDay(d, addDays(today, -1))) return m.common.yesterday;
  return capitalize(d.toLocaleDateString(locale(), { weekday: "long" }));
}

export const timeOf = (e: CalendarEvent) => new Date(e.startsAt).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

/** One colour per calendar: Apple's system colours (`calendar.css`). */
export const TONE: Record<Category, string> = {
  macro: "var(--cal-macro)",
  unlock: "var(--cal-unlock)",
  listing: "var(--cal-listing)",
  expiry: "var(--cal-expiry)",
  upgrade: "var(--cal-upgrade)",
  project: "var(--cal-project)",
  task: "var(--cal-task)",
  scheduled: "var(--cal-scheduled)",
};

export const toneOf = (c: Category) => ({ "--tone": TONE[c] }) as CSSProperties;
