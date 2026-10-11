import { currentMessages } from "@/lib/i18n/store";
import { parseFrequency, type Frequency } from "../core/frequency";

/* ---------------------------------------------------------------------------
   A frequency as the USER reads it, in the interface's language: "every
   Monday at 09:30", « tous les lundis à 09:30 », 每周一 09:30. The stored
   text ("every monday at 09:30") stays the grammar an agent writes, and
   `describeFrequency` (`../core/frequency.ts`) keeps the English the agent
   reads; this is only for the screens (the DCA and Scheduled tasks tabs,
   the thread's widgets). The words are in `scheduler.frequency`. Read at
   call time, from a component that reads `useMessages()`.
--------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** A sentence's first letter up (a no-op in Chinese). */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The frequency in the middle of a sentence ("every 4 hours"). */
export function sayFrequency(f: Frequency): string {
  const w = currentMessages().scheduler.frequency;
  if (f.kind === "interval") {
    if (f.minutes % 1440 === 0) return f.minutes === 1440 ? w.everyDay : w.everyDays(f.minutes / 1440);
    if (f.minutes % 60 === 0) return f.minutes === 60 ? w.everyHour : w.everyHours(f.minutes / 60);
    return f.minutes === 1 ? w.everyMinute : w.everyMinutes(f.minutes);
  }
  const at = `${pad(f.hour)}:${pad(f.minute)}`;
  return f.kind === "daily" ? w.dailyAt(at) : w.weeklyAt(f.weekday, at);
}

/** A stored frequency in the middle of a sentence; the text itself when it
    does not parse. */
export function frequencyPhrase(text: string): string {
  const f = parseFrequency(text);
  return "error" in f ? text : sayFrequency(f);
}

/** A stored frequency on its own, its first letter up ("Every 4 hours"). */
export const frequencyLabel = (text: string): string => capitalize(frequencyPhrase(text));
