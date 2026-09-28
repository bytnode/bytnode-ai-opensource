/* ---------------------------------------------------------------------------
   How often something runs, in words a user reads and an agent writes.

     every 15 minutes      every 2 hours      every hour
     daily at 08:00        every monday at 09:30

   No full cron: these cover alerts, snapshots, refreshes, recurring
   purchases and morning briefings. Times are the machine's local time.

   Pure, tested.
--------------------------------------------------------------------------- */

export type Frequency =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MINUTE = 60_000;
/** Below a minute, the scheduler's clock cannot keep up; above a month, it
    is not a routine. */
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 31 * 24 * 60;

const EXAMPLES = "`every 15 minutes`, `every 2 hours`, `daily at 08:00`, `every monday at 09:30`";

function clock(h: string, m: string): { hour: number; minute: number } | null {
  const hour = Number(h);
  const minute = Number(m);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function parseFrequency(text: string): Frequency | { error: string } {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^every (\d+) (minute|minutes|hour|hours|day|days)$/.exec(t) ?? /^every (minute|hour|day)$/.exec(t);
  if (m) {
    const n = m.length === 3 ? Number(m[1]) : 1;
    const unit = m.length === 3 ? m[2] : m[1];
    const minutes = n * (unit.startsWith("minute") ? 1 : unit.startsWith("hour") ? 60 : 1440);
    if (minutes < MIN_INTERVAL || minutes > MAX_INTERVAL) return { error: `Frequency out of range: "${text}" (between 1 minute and 31 days).` };
    return { kind: "interval", minutes };
  }
  m = /^(?:daily|every day) at (\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const c = clock(m[1], m[2]);
    return c ? { kind: "daily", ...c } : { error: `Invalid time in "${text}".` };
  }
  m = /^every (\w+) at (\d{1,2}):(\d{2})$/.exec(t);
  if (m && WEEKDAYS.includes(m[1])) {
    const c = clock(m[2], m[3]);
    return c ? { kind: "weekly", weekday: WEEKDAYS.indexOf(m[1]), ...c } : { error: `Invalid time in "${text}".` };
  }
  return { error: `Unreadable frequency: "${text}". Expected: ${EXAMPLES}.` };
}

export const isFrequency = (text: string): boolean => !("error" in parseFrequency(text));

const pad = (n: number) => String(n).padStart(2, "0");

/** The frequency as the user reads it back. */
export function describeFrequency(f: Frequency): string {
  if (f.kind === "interval") {
    if (f.minutes % 1440 === 0) return f.minutes === 1440 ? "every day" : `every ${f.minutes / 1440} days`;
    if (f.minutes % 60 === 0) return f.minutes === 60 ? "every hour" : `every ${f.minutes / 60} hours`;
    return f.minutes === 1 ? "every minute" : `every ${f.minutes} minutes`;
  }
  const at = `${pad(f.hour)}:${pad(f.minute)}`;
  return f.kind === "daily" ? `daily at ${at}` : `every ${WEEKDAYS[f.weekday]} at ${at}`;
}

/** The next run after `after` (ms): for an interval, `after` is the start
    of the previous run and the next one comes one step later (possibly
    already due: it runs once, then counts again from there — no burst);
    for a time of day, the first occurrence strictly after `after`. */
export function nextRun(f: Frequency, after: number): number {
  if (f.kind === "interval") return after + f.minutes * MINUTE;
  const from = new Date(after);
  /* ⚠️ Each candidate day is built from its date AND the wanted time. On
     the spring change, 02:30 does not exist and the Date lands on 03:30;
     moving THAT object day by day kept 03:30 for every run after it. */
  const on = (dayOffset: number) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + dayOffset, f.hour, f.minute).getTime();
  let offset = f.kind === "weekly" ? (f.weekday - from.getDay() + 7) % 7 : 0;
  while (on(offset) <= after) offset += f.kind === "weekly" ? 7 : 1;
  return on(offset);
}

/** Was a run due between the last one and now, while nothing was running
    (app closed, no tab open)? */
export const missedSince = (f: Frequency, lastRun: number, now: number): boolean => nextRun(f, lastRun) <= now;
