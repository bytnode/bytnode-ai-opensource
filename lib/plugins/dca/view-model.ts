import type { DcaPlan, PlanSummary } from "./plans";

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

export type Cadence = { kind: "daily"; time: string } | { kind: "weekly"; weekday: Weekday; time: string } | { kind: "days"; days: number; time?: string };

/** The form's choice as a plan's frequency. */
export function frequencyOf(c: Cadence): string {
  if (c.kind === "daily") return `daily at ${c.time}`;
  if (c.kind === "weekly") return `every ${c.weekday} at ${c.time}`;
  return `every ${Math.max(1, Math.round(c.days))} day${Math.round(c.days) === 1 ? "" : "s"}`;
}

/** A frequency read back in a sentence's words ("every Monday at 09:00"). */
export function frequencyWords(frequency: string): string {
  return frequency.replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, (d) => d[0].toUpperCase() + d.slice(1)).replace(/^daily/, "Every day");
}
