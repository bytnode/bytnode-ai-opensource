import type { Category } from "@/lib/plugins/calendar/events";
import type { Period } from "@/lib/plugins/calendar/days";

/* ---------------------------------------------------------------------------
   Where the Calendar tab was left: the period, the month on screen, the
   filters. A view unmounts when another tab comes to the front
   (`components/shell/app-shell.tsx`), so its state would start over —
   "This week" came back as "Today". Kept in memory for the page's life,
   never on disk: a reload starts on today, which is what a calendar
   should open on.
--------------------------------------------------------------------------- */

export type Remembered = {
  period?: Period;
  month?: Date;
  hidden?: Category[];
  strongOnly?: boolean;
  watchlistOnly?: boolean;
};

const memory: Remembered = {};

export const recall = (): Remembered => memory;

export function remember(patch: Remembered) {
  Object.assign(memory, patch);
}
