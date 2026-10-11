import { currentMessages, dateTag } from "@/lib/i18n/store";
import { nextRun, parseFrequency } from "../core/frequency";
import { frequencyLabel, sayFrequency } from "../shared/frequency-words";

/* ---------------------------------------------------------------------------
   The next hours of the scheduler, for the view's timeline: when each
   agent task and each plugin job will run. What runs every hour or more
   often would cover the line with dots: it is a BAND (always on), said
   apart. The rest are MARKS, from the next run the state knows (else the
   next one after now) through the window. Plus the words the view uses:
   a frequency as read back, a time relative to now. Pure, tested.
--------------------------------------------------------------------------- */

export type Scheduled = { id: string; title: string; every: string; kind: "task" | "job"; paused?: boolean; nextRun?: string };

export type Mark = { id: string; title: string; kind: "task" | "job"; at: number };
export type Band = { id: string; title: string; kind: "task" | "job"; every: string };

const HOUR = 3_600_000;
const MAX_MARKS = 48;

export function timeline(items: Scheduled[], now: number, hours = 24): { marks: Mark[]; bands: Band[] } {
  const end = now + hours * HOUR;
  const marks: Mark[] = [];
  const bands: Band[] = [];
  for (const it of items) {
    if (it.paused) continue;
    const f = parseFrequency(it.every);
    if ("error" in f) continue;
    if (f.kind === "interval" && f.minutes <= 60) {
      bands.push({ id: it.id, title: it.title, kind: it.kind, every: sayFrequency(f) });
      continue;
    }
    const known = it.nextRun ? Date.parse(it.nextRun) : NaN;
    let t = Number.isFinite(known) && known >= now ? known : nextRun(f, now);
    for (let n = 0; t <= end && n < MAX_MARKS; n++) {
      marks.push({ id: it.id, title: it.title, kind: it.kind, at: t });
      t = f.kind === "interval" ? t + f.minutes * 60_000 : nextRun(f, t);
    }
  }
  return { marks: marks.sort((a, b) => a.at - b.at), bands };
}

/** A frequency as the user reads it back, in the interface's language:
    "Daily at 08:00", "Every 4 hours". */
export const frequencyText = (every: string): string => frequencyLabel(every);

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A moment against now, in the machine's time and the interface's
    language: "in 12 min", "in 2 h 05", "tomorrow 08:00", "Mon 09:30",
    "5 min ago", "yesterday 08:00", "12 Sept". */
export function relative(iso: string | number | undefined, now: number): string {
  const w = currentMessages().scheduler.relative;
  if (iso === undefined) return "—";
  const at = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  const diff = at - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const dayOf = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((dayOf(at) - dayOf(now)) / 86_400_000);
  const weekday = () => d.toLocaleDateString(dateTag(), { weekday: "short" });
  if (minutes < 1) return diff >= 0 ? w.now : w.justNow;
  if (diff >= 0) {
    if (minutes < 60) return w.inMinutes(minutes);
    if (minutes < 6 * 60) return w.inHours(Math.floor(minutes / 60), pad(minutes % 60));
    if (days === 0) return w.todayAt(clock(d));
    if (days === 1) return w.tomorrowAt(clock(d));
    if (days < 7) return w.weekdayAt(weekday(), clock(d));
  } else {
    if (minutes < 60) return w.minutesAgo(minutes);
    if (minutes < 6 * 60) return w.hoursAgo(Math.floor(minutes / 60));
    if (days === 0) return w.todayAt(clock(d));
    if (days === -1) return w.yesterdayAt(clock(d));
    if (days > -7) return w.weekdayAt(weekday(), clock(d));
  }
  return d.toLocaleDateString(dateTag(), { day: "numeric", month: "short" });
}
