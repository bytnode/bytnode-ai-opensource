import { holds, parseUntil, type Condition as Until, type Sample } from "@/lib/tools/exchange/watch-until";
import { metricKey, metricLabel, parseMetric, type ChangeWindow, type Metric } from "./metrics";

/* ---------------------------------------------------------------------------
   What an alert watches: ExchangeWatch's grammar (`price>=70000`,
   `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`), extended to

     change24h>5%     the change over 1h, 4h, 24h or 7d (BytNode)
     funding>0.05%    the funding rate, in % per 8 h
     event<24h        a notable calendar event for the asset within N hours

   and to any METRIC (`./metrics.ts`) against a level or another metric:

     rsi(14,1h)<30                      the RSI under 30
     price>ema(200,4h)                  the price above its 200 EMA
     ema(50,1d) crosses_above ema(200,1d)   a golden cross
     macd(12,26,9,4h).hist crosses_above 0

   `<` `<=` `>` `>=` hold while it is so — the alert fires when it BECOMES
   so, at once if it already is. `crosses_above` / `crosses_below` wait for
   a crossing that happens after the alert is set.

   A condition that cannot be evaluated (no price, not enough candles, no
   position readable) is an ERROR, never a silent false. Pure, tested; the
   view uses it too.
--------------------------------------------------------------------------- */

type Op = "<" | "<=" | ">" | ">=";
export type CompareOp = Op | "crosses_above" | "crosses_below";
export type Window = ChangeWindow;
export type Operand = { value: number } | { metric: Metric };

export type AlertCondition =
  | { kind: "until"; until: Until }
  | { kind: "change"; window: Window; op: Op; value: number }
  | { kind: "funding"; op: Op; value: number }
  | { kind: "event"; hours: number }
  | { kind: "compare"; left: Metric; op: CompareOp; right: Operand };

/** What was read for one asset at one evaluation. */
export type Reading = {
  price?: number;
  change?: Partial<Record<Window, number>>;
  funding?: number;
  /** Indicator values by metric key (`rsi(14,1h)`). */
  values?: Record<string, number>;
  position?: { open: boolean; pnl?: number; pnlPct?: number; liqPct?: number; mark?: number };
  /** Notable calendar events concerning the asset, in the widest window asked. */
  events?: Array<{ title: string; startsAt: string }>;
  /** Why a part could not be read. */
  errors?: { price?: string; funding?: string; position?: string; events?: string; values?: Record<string, string> };
};

export const EXAMPLES =
  "`price>=70000`, `change24h>5%`, `funding>0.05%`, `rsi(14,1h)<30`, `price>ema(200,4h)`, `ema(50,1d) crosses_above ema(200,1d)`, `macd(12,26,9,4h).hist crosses_above 0`, `price<bb(20,2,1h).lower`, `stoch(14,3,15m).k>80`, `event<24h`, and on a futures position `pnl<-50`, `pnl%<-2`, `liq<3%`, `closed`";

export const METRICS_HELP =
  "Metrics: `price`, `change1h|4h|24h|7d` (%), `funding` (% / 8 h), `rsi(length,tf)`, `ema(length,tf)`, `sma(length,tf)`, `macd(fast,slow,signal,tf).macd|signal|hist`, `bb(length,deviations,tf).upper|middle|lower`, `stoch(length,smoothing,tf).k|d`, `atr(length,tf)`, `volume(tf)`; tf = 15m, 1h, 4h or 1d. " +
  "Operators: `<` `<=` `>` `>=` (fires when it becomes true, at once if it already is), `crosses_above` / `crosses_below` (only a crossing after the alert is set). The right side is a number or another metric.";

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const CHANGE = new RegExp(`^change\\s*(1h|4h|24h|7d)\\s*(<=|>=|<|>)\\s*${NUM}\\s*%?$`, "i");
const FUNDING = new RegExp(`^funding\\s*(<=|>=|<|>)\\s*${NUM}\\s*%?$`, "i");
const EVENT = /^event\s*<\s*(\d{1,3})\s*h$/i;
const POSITION = /^(pnl%?|liq)\s*(<=|>=|<|>)|^closed$/i;
const COMPARE = /^(.+?)\s*(crosses[_\s]?above|crosses[_\s]?below|<=|>=|<|>)\s*(.+)$/i;
const NUMBER = /^(-?\d+(?:\.\d+)?)\s*%?$/;
const MAX_EVENT_HOURS = 168;

export function parseCondition(text: string): AlertCondition | { error: string } {
  const t = text.trim();
  let m = CHANGE.exec(t);
  if (m) return { kind: "change", window: m[1].toLowerCase() as Window, op: m[2] as Op, value: Number(m[3]) };
  m = FUNDING.exec(t);
  if (m) return { kind: "funding", op: m[1] as Op, value: Number(m[2]) };
  m = EVENT.exec(t);
  if (m) {
    const hours = Number(m[1]);
    return hours >= 1 && hours <= MAX_EVENT_HOURS ? { kind: "event", hours } : { error: `An event window between 1 and ${MAX_EVENT_HOURS} hours.` };
  }
  if (POSITION.test(t) || /^price\s*(<=|>=|<|>)\s*-?\d/i.test(t)) {
    const until = parseUntil(t);
    if (!("error" in until)) return { kind: "until", until };
  }
  m = COMPARE.exec(t);
  if (m) {
    const left = parseMetric(m[1]);
    if ("error" in left) return { error: `${left.error} ${METRICS_HELP}` };
    const opText = m[2].toLowerCase().replace(/[_\s]/g, "");
    const op: CompareOp = opText === "crossesabove" ? "crosses_above" : opText === "crossesbelow" ? "crosses_below" : (opText as Op);
    const num = NUMBER.exec(m[3].trim());
    if (num) return { kind: "compare", left, op, right: { value: Number(num[1]) } };
    const right = parseMetric(m[3]);
    if ("error" in right) return { error: `${right.error} ${METRICS_HELP}` };
    return { kind: "compare", left, op, right: { metric: right } };
  }
  return { error: `Unreadable condition: "${t}". Expected: ${EXAMPLES}.` };
}

/** The condition written back, the same way every time. */
export function conditionText(c: AlertCondition, original: string): string {
  if (c.kind !== "compare") return original.replace(/\s+/g, "");
  const right = "value" in c.right ? String(c.right.value) : metricKey(c.right.metric);
  const op = c.op === "crosses_above" || c.op === "crosses_below" ? ` ${c.op} ` : c.op;
  return `${metricKey(c.left)}${op}${right}`;
}

/** A condition on a futures position (read from an exchange account). */
export const onPosition = (c: AlertCondition): boolean => c.kind === "until" && c.until.field !== "price";

/** Only a crossing after the alert is set fires it: `closed` (a position
    must have been open) and the `crosses_*` operators. */
export const waitsForCrossing = (c: AlertCondition): boolean => (c.kind === "until" && c.until.field === "closed") || (c.kind === "compare" && (c.op === "crosses_above" || c.op === "crosses_below"));

/** The metrics a condition reads, beyond the price. */
export const metricsOf = (c: AlertCondition): Metric[] => (c.kind === "compare" ? [c.left, ...("metric" in c.right ? [c.right.metric] : [])] : []);

const compare = (a: number, op: Op, b: number) => (op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);
const fmt = (n: number) => Number(n.toPrecision(Math.abs(n) >= 1 ? 8 : 4)).toString();
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} %`;
const SIGN: Record<CompareOp, string> = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", crosses_above: "crosses above", crosses_below: "crosses below" };

/** The condition as a person reads it: "RSI 14 · 1H crosses below 30". */
export function describeCondition(c: AlertCondition): string {
  switch (c.kind) {
    case "change":
      return `${c.window} change ${SIGN[c.op]} ${c.value >= 0 ? "+" : ""}${c.value} %`;
    case "funding":
      return `Funding ${SIGN[c.op]} ${c.value} %`;
    case "event":
      return `A notable event within ${c.hours} h`;
    case "compare": {
      const unit = c.left.kind === "change" || c.left.kind === "funding" ? " %" : "";
      const right = "value" in c.right ? `${c.right.value}${unit}` : metricLabel(c.right.metric);
      return `${metricLabel(c.left)} ${SIGN[c.op]} ${right}`;
    }
    case "until": {
      const u = c.until;
      if (u.field === "closed") return "Position closed";
      if (u.field === "price") return `Price ${SIGN[u.op]} ${u.value}`;
      if (u.field === "liqPct") return `Liquidation ${SIGN[u.op]} ${u.value} % away`;
      return `Position PnL ${SIGN[u.op]} ${u.value}${u.field === "pnlPct" ? " %" : ""}`;
    }
  }
}

/** A metric's value in a reading, or why there is none. */
function valueOf(m: Metric, r: Reading): number | { error: string } {
  switch (m.kind) {
    case "price":
      return r.price ?? { error: r.errors?.price ?? "No price available." };
    case "change":
      return r.change?.[m.window] ?? { error: r.errors?.price ?? `No ${m.window} change available (BytNode gives it; an exchange ticker only has 24 h).` };
    case "funding":
      return r.funding ?? { error: r.errors?.funding ?? "No funding rate available." };
    default: {
      const key = metricKey(m);
      return r.values?.[key] ?? { error: r.errors?.values?.[key] ?? `No value for ${metricLabel(m)}.` };
    }
  }
}

/** What the watched side reads now, when it is a number (the view starts
    a level from it). */
export function currentValue(c: AlertCondition, r: Reading): number | undefined {
  if (c.kind === "compare") {
    const v = valueOf(c.left, r);
    return typeof v === "number" ? v : undefined;
  }
  if (c.kind === "until" && c.until.field === "price") return r.price;
  if (c.kind === "change") return r.change?.[c.window];
  if (c.kind === "funding") return r.funding;
  return undefined;
}

const shown = (m: Metric, v: number) => (m.kind === "change" ? pct(v) : m.kind === "funding" ? `${fmt(v)} %` : fmt(v));

export type Evaluation = { holds: boolean; observed: string } | { error: string };

/** The condition against what was read, at `now`. */
export function evaluate(c: AlertCondition, r: Reading, now: Date): Evaluation {
  switch (c.kind) {
    case "compare": {
      const left = valueOf(c.left, r);
      if (typeof left !== "number") return left;
      const right = "value" in c.right ? c.right.value : valueOf(c.right.metric, r);
      if (typeof right !== "number") return right;
      const above = c.op === "crosses_above" ? ">" : c.op === "crosses_below" ? "<" : c.op;
      const observed = `${metricLabel(c.left)} ${shown(c.left, left)}${"metric" in c.right ? `, ${metricLabel(c.right.metric)} ${shown(c.right.metric, right)}` : ""}`;
      return { holds: compare(left, above, right), observed };
    }
    case "change": {
      const v = r.change?.[c.window];
      if (v === undefined) return { error: r.errors?.price ?? `No ${c.window} change available (BytNode gives it; an exchange ticker only has 24 h).` };
      return { holds: compare(v, c.op, c.value), observed: `${c.window} change ${pct(v)}` };
    }
    case "funding":
      if (r.funding === undefined) return { error: r.errors?.funding ?? "No funding rate available." };
      return { holds: compare(r.funding, c.op, c.value), observed: `funding ${fmt(r.funding)} % / 8 h` };
    case "event": {
      if (!r.events) return { error: r.errors?.events ?? "The calendar is off." };
      const limit = now.getTime() + c.hours * 3600_000;
      const next = r.events.find((e) => Date.parse(e.startsAt) >= now.getTime() && Date.parse(e.startsAt) <= limit);
      if (!next) return { holds: false, observed: `no notable event within ${c.hours} h` };
      const inHours = Math.max(0, Math.round((Date.parse(next.startsAt) - now.getTime()) / 3600_000));
      return { holds: true, observed: `${next.title} in ${inHours} h` };
    }
    case "until": {
      if (c.until.field === "price") {
        if (r.price === undefined) return { error: r.errors?.price ?? "No price available." };
        return { holds: holds(c.until, { price: r.price, open: false }), observed: `price ${fmt(r.price)}` };
      }
      if (!r.position) return { error: r.errors?.position ?? "The position could not be read." };
      const p = r.position;
      const sample: Sample = { price: p.mark ?? r.price ?? 0, open: p.open, pnl: p.pnl, pnlPct: p.pnlPct, liqPct: p.liqPct };
      const observed = !p.open
        ? "no open position"
        : [p.pnl !== undefined ? `PnL ${fmt(p.pnl)}` : "", p.pnlPct !== undefined ? `PnL ${pct(p.pnlPct)}` : "", p.liqPct !== undefined ? `liquidation at ${fmt(Math.abs(p.liqPct))} %` : ""].filter(Boolean).join(", ");
      /* A position that is not open satisfies only `closed`. */
      if (!p.open && c.until.field !== "closed") return { holds: false, observed };
      return { holds: holds(c.until, sample), observed };
    }
  }
}
