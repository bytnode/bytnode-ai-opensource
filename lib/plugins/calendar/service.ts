import type { CalendarEvent } from "./events";

/* What the calendar offers the plugins that use it (the alerts): the
   coming events, collected and computed alike. */
export type CalendarService = {
  upcoming(query: { assets?: string[]; withinHours: number; minImportance?: number }): Promise<CalendarEvent[]>;
};
