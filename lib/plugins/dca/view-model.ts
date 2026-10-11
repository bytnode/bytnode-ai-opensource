import { nextRun, parseFrequency } from "../core/frequency";
import { frequencyLabel, frequencyPhrase } from "../shared/frequency-words";
import { firstDue, type DcaPlan, type PlanSummary } from "./plans";

/* ---------------------------------------------------------------------------
   What the DCA tab shows of a plan, a group or all of them: what was
   invested, what it is worth at the current price, the result; and the
   form's frequency, from its three simple choices to the words the plans
   store ("every monday at 09:00").
   Pure, tested.
--------------------------------------------------------------------------- */

export type PlanRow = DcaPlan & { summary: PlanSummary };

export type Figures = {
  invested: number;
  /** At the current prices; absent while a price is missing. */
  value?: number;
  pnl?: number;
  /** In %. */
  pct?: number;
  purchases: number;
  pending: number;
  /** One plan: the quantity bought, its average price, the current one. */
  amount?: number;
  average?: number;
  price?: number;
};

export function planFigures(plan: PlanRow, price: number | undefined): Figures {
  const s = plan.summary;
  const value = price !== undefined ? s.amount * price : undefined;
  const pnl = value !== undefined && s.purchases ? value - s.invested : undefined;
  return {
    invested: s.invested,
    ...(value !== undefined ? { value } : {}),
    ...(pnl !== undefined ? { pnl, pct: s.invested > 0 ? (pnl / s.invested) * 100 : 0 } : {}),
    purchases: s.purchases,
    pending: s.pending,
    amount: s.amount,
    ...(s.average !== undefined ? { average: s.average } : {}),
    ...(price !== undefined ? { price } : {}),
  };
}

/** Several plans added: a value only when every plan that bought has a price. */
export function sumFigures(list: Figures[]): Figures {
  const invested = list.reduce((t, f) => t + f.invested, 0);
  const priced = list.every((f) => f.purchases === 0 || f.value !== undefined);
  const value = priced ? list.reduce((t, f) => t + (f.value ?? 0), 0) : undefined;
  const pnl = value !== undefined && invested > 0 ? value - invested : undefined;
  return {
    invested,
    ...(value !== undefined ? { value } : {}),
    ...(pnl !== undefined ? { pnl, pct: (pnl / invested) * 100 } : {}),
    purchases: list.reduce((t, f) => t + f.purchases, 0),
    pending: list.reduce((t, f) => t + f.pending, 0),
  };
}

/** The currency a set of plans is counted in: their quote when they share
    one, else USD (stablecoins taken at a dollar). */
export function unitOf(plans: DcaPlan[]): string {
  const quotes = new Set(plans.map((p) => p.symbol.split("/")[1]));
  return quotes.size === 1 ? [...quotes][0] : "USD";
}

/** The soonest due date among active plans. */
export function nextDue(plans: DcaPlan[]): string | undefined {
  return plans
    .filter((p) => p.status === "active" && p.nextDue)
    .map((p) => p.nextDue!)
    .sort()[0];
}

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Cadence = { kind: "daily"; time: string } | { kind: "weekly"; weekday: Weekday; time: string } | { kind: "days"; days: number } | { kind: "hours"; hours: number };

/** The form's choice as a plan's frequency. */
export function frequencyOf(c: Cadence): string {
  if (c.kind === "daily") return `daily at ${c.time}`;
  if (c.kind === "weekly") return `every ${c.weekday} at ${c.time}`;
  const n = Math.max(1, Math.round(c.kind === "days" ? c.days : c.hours));
  const unit = c.kind === "days" ? "day" : "hour";
  return `every ${n} ${unit}${n === 1 ? "" : "s"}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const JS_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** A stored frequency back as the form's choice (to configure a DCA). */
export function cadenceOf(frequency: string): Cadence {
  const f = parseFrequency(frequency);
  if ("error" in f) return { kind: "weekly", weekday: "monday", time: "09:00" };
  if (f.kind === "daily") return { kind: "daily", time: `${pad(f.hour)}:${pad(f.minute)}` };
  if (f.kind === "weekly") return { kind: "weekly", weekday: JS_DAYS[f.weekday] as Weekday, time: `${pad(f.hour)}:${pad(f.minute)}` };
  return f.minutes % 1440 === 0 ? { kind: "days", days: f.minutes / 1440 } : { kind: "hours", hours: Math.max(1, Math.round(f.minutes / 60)) };
}

/* --- What a configuration will do ---------------------------------------- */

/** The purchase dates from `start` (ms), at most `n`, none after `end`. */
export function schedule(frequency: string, start: number, end: number | undefined, n: number): number[] {
  const f = parseFrequency(frequency);
  if ("error" in f) return [];
  const out: number[] = [];
  let t = firstDue(f, start);
  while (out.length < n && (end === undefined || t <= end)) {
    out.push(t);
    t = nextRun(f, t);
  }
  return out;
}

/** How many purchases in 30 days. */
export function perMonth(frequency: string): number {
  const f = parseFrequency(frequency);
  if ("error" in f) return 0;
  if (f.kind === "daily") return 30;
  if (f.kind === "weekly") return 30 / 7;
  return (30 * 1440) / f.minutes;
}

/** The date of the `n`th purchase from `start`: an end "after n purchases". */
export function nthPurchase(frequency: string, start: number, n: number): number | undefined {
  const dates = schedule(frequency, start, undefined, Math.max(1, Math.round(n)));
  return dates.length ? dates[dates.length - 1] : undefined;
}

/** How many purchases between `start` and `end` (counted up to 10 000). */
export const purchasesUntil = (frequency: string, start: number, end: number): number => schedule(frequency, start, end, 10_000).length;

/** A frequency read back on its own, in the interface's language ("Every
    Monday at 09:00"); `frequencyPhrase` gives it for the middle of a
    sentence ("every Monday at 09:00"). */
export const frequencyWords = (frequency: string): string => frequencyLabel(frequency);

export { frequencyPhrase };
