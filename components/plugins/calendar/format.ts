import type { CSSProperties } from "react";
import type { CalendarEvent, Category } from "@/lib/plugins/calendar/events";

/* How the calendar writes dates and paints its calendars. The interface
   speaks English: dates too — day before month, a 24-hour clock. */

export const LOCALE = "en-GB";

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
