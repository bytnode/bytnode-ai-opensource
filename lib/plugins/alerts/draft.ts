import type { Interval } from "../shared/candle";
import { parseCondition, type AlertCondition, type CompareOp } from "./conditions";
import { metricKey, type Metric, type MetricKind } from "./metrics";

/* ---------------------------------------------------------------------------
   The alert the view's form builds, before it is a condition: WHAT is
   watched (a metric, a position figure, a calendar event), HOW it is
   compared (above, below, crosses), and AGAINST what (a level or another
   metric) — turned into the condition text the plugin stores, the same
   an agent writes. The presets are drafts too. Pure, tested.
--------------------------------------------------------------------------- */

export type PositionField = "pnl" | "pnlPct" | "liq" | "closed";

export type Subject = { kind: "metric"; metric: Metric } | { kind: "position"; field: PositionField } | { kind: "event"; hours: number };

export type Against = { kind: "value"; value: string } | { kind: "metric"; metric: Metric };

export type Draft = { subject: Subject; op: CompareOp; against: Against };

/** A metric of that kind with its usual parameters, on `tf`. */
export function defaultMetric(kind: MetricKind, tf: Interval = "1h"): Metric {
  switch (kind) {
    case "price":
    case "funding":
      return { kind };
    case "change":
      return { kind: "change", window: "24h" };
    case "rsi":
    case "atr":
      return { kind, length: 14, tf };
    case "ema":
    case "sma":
      return { kind, length: kind === "ema" ? 200 : 50, tf };
    case "macd":
      return { kind: "macd", fast: 12, slow: 26, signal: 9, tf, line: "hist" };
    case "bb":
      return { kind: "bb", length: 20, mult: 2, tf, band: "upper" };
    case "stoch":
      return { kind: "stoch", length: 14, smooth: 3, tf, line: "k" };
    case "volume":
      return { kind: "volume", tf };
  }
}

/** What a metric is usually compared with: RSI with a level, a moving
    average with the price… */
export function defaultAgainst(m: Metric): Against {
  switch (m.kind) {
    case "rsi":
      return { kind: "value", value: "30" };
    case "stoch":
      return { kind: "value", value: "80" };
    case "change":
      return { kind: "value", value: "5" };
    case "funding":
      return { kind: "value", value: "0.05" };
    case "macd":
      return { kind: "value", value: "0" };
    default:
      return { kind: "value", value: "" };
  }
}

const OPS: Record<CompareOp, string> = { "<": "<", "<=": "<=", ">": ">", ">=": ">=", crosses_above: " crosses_above ", crosses_below: " crosses_below " };
const simple = (op: CompareOp) => (op === "crosses_above" ? ">" : op === "crosses_below" ? "<" : op);

/** Does the subject compare at all (`closed` and an event do not)? */
export const compares = (s: Subject): boolean => !(s.kind === "event" || (s.kind === "position" && s.field === "closed"));

/** Can the subject cross (a position figure only goes above or below)? */
export const crosses = (s: Subject): boolean => s.kind === "metric";

/** The condition text of a draft, or why it is not one yet. */
export function buildCondition(d: Draft): string | { error: string } {
  const s = d.subject;
  if (s.kind === "event") return Number.isInteger(s.hours) && s.hours >= 1 && s.hours <= 168 ? `event<${s.hours}h` : { error: "An event window between 1 and 168 hours." };
  if (s.kind === "position" && s.field === "closed") return "closed";
  let right: string;
  if (d.against.kind === "value") {
    const v = d.against.value.trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(v)) return { error: "Enter a number." };
    right = String(Number(v));
  } else {
    if (s.kind !== "metric") return { error: "A position figure is compared with a number." };
    right = metricKey(d.against.metric);
  }
  if (s.kind === "position") return `${s.field === "pnlPct" ? "pnl%" : s.field}${simple(d.op)}${right}`;
  return `${metricKey(s.metric)}${OPS[d.op]}${right}`;
}

/** The draft's condition, parsed — what the summary and the preview read. */
export function draftCondition(d: Draft): AlertCondition | { error: string } {
  const text = buildCondition(d);
  return typeof text === "string" ? parseCondition(text) : text;
}

export type Preset = { id: string; label: string; draft: Draft; position?: true };

const m = (metric: Metric): Subject => ({ kind: "metric", metric });

export const PRESETS: Preset[] = [
  { id: "level", label: "Price level", draft: { subject: m({ kind: "price" }), op: "crosses_above", against: { kind: "value", value: "" } } },
  { id: "oversold", label: "RSI oversold", draft: { subject: m({ kind: "rsi", length: 14, tf: "1h" }), op: "crosses_below", against: { kind: "value", value: "30" } } },
  { id: "overbought", label: "RSI overbought", draft: { subject: m({ kind: "rsi", length: 14, tf: "1h" }), op: "crosses_above", against: { kind: "value", value: "70" } } },
  { id: "golden", label: "Golden cross", draft: { subject: m({ kind: "ema", length: 50, tf: "1d" }), op: "crosses_above", against: { kind: "metric", metric: { kind: "ema", length: 200, tf: "1d" } } } },
  { id: "ema200", label: "Price vs EMA 200", draft: { subject: m({ kind: "price" }), op: "crosses_above", against: { kind: "metric", metric: { kind: "ema", length: 200, tf: "4h" } } } },
  { id: "macd", label: "MACD turns up", draft: { subject: m({ kind: "macd", fast: 12, slow: 26, signal: 9, tf: "4h", line: "hist" }), op: "crosses_above", against: { kind: "value", value: "0" } } },
  { id: "breakout", label: "Bollinger breakout", draft: { subject: m({ kind: "price" }), op: "crosses_above", against: { kind: "metric", metric: { kind: "bb", length: 20, mult: 2, tf: "1h", band: "upper" } } } },
  { id: "move", label: "Big daily move", draft: { subject: m({ kind: "change", window: "24h" }), op: ">", against: { kind: "value", value: "5" } } },
  { id: "funding", label: "Funding spike", draft: { subject: m({ kind: "funding" }), op: ">", against: { kind: "value", value: "0.05" } } },
  { id: "liq", label: "Near liquidation", draft: { subject: { kind: "position", field: "liq" }, op: "<", against: { kind: "value", value: "5" } }, position: true },
];
