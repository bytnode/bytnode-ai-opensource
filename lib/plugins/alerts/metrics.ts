import type { Candle, Interval } from "../shared/candle";
import { atr, bollinger, ema, macd, rsi, sma, stochastic } from "../shared/indicators";

/* ---------------------------------------------------------------------------
   What an alert can watch on an asset, as a METRIC with its parameters —
   written the way an agent and the view both write it:

     price                        the last price
     change1h change4h change24h change7d     the change, in %
     funding                      the funding rate, in % per 8 h
     rsi(14,1h)                   RSI, length, timeframe
     ema(200,4h)  sma(50,1d)      moving averages of the close
     macd(12,26,9,4h).hist        MACD line (`.macd`), `.signal`, `.hist`
     bb(20,2,1h).upper            Bollinger bands: `.upper` `.middle` `.lower`
     stoch(14,3,1h).k             stochastic %K (`.k`) or %D (`.d`)
     atr(14,1d)                   average true range
     volume(1h)                   the volume of the current bar

   Parameters may be left out (`rsi`, `rsi(14)`): the usual defaults, on
   the hour. Timeframes: 15m, 1h, 4h, 1d. Indicators are computed from the
   pair's candles (`../shared/indicators.ts`). Pure, tested; the view uses
   it too.
--------------------------------------------------------------------------- */

export const TIMEFRAMES: Interval[] = ["15m", "1h", "4h", "1d"];
export type ChangeWindow = "1h" | "4h" | "24h" | "7d";
export const WINDOWS: ChangeWindow[] = ["1h", "4h", "24h", "7d"];

export type Metric =
  | { kind: "price" }
  | { kind: "change"; window: ChangeWindow }
  | { kind: "funding" }
  | { kind: "rsi"; length: number; tf: Interval }
  | { kind: "ema" | "sma"; length: number; tf: Interval }
  | { kind: "macd"; fast: number; slow: number; signal: number; tf: Interval; line: "macd" | "signal" | "hist" }
  | { kind: "bb"; length: number; mult: number; tf: Interval; band: "upper" | "middle" | "lower" }
  | { kind: "stoch"; length: number; smooth: number; tf: Interval; line: "k" | "d" }
  | { kind: "atr"; length: number; tf: Interval }
  | { kind: "volume"; tf: Interval };

export type MetricKind = Metric["kind"];

/** A metric that needs the pair's candles, and on which timeframe. */
export const timeframeOf = (m: Metric): Interval | null => ("tf" in m ? m.tf : null);

/** The candles an indicator needs to settle (an EMA remembers its start). */
export function barsNeeded(m: Metric): number {
  switch (m.kind) {
    case "rsi":
    case "atr":
      return Math.max(150, m.length * 10);
    case "ema":
      return Math.max(150, m.length * 4);
    case "macd":
      return Math.max(200, (m.slow + m.signal) * 4);
    case "sma":
    case "bb":
    case "stoch":
      return m.length + 10;
    default:
      return 10;
  }
}

/** The metric written back, the same way every time: it is also its key. */
export function metricKey(m: Metric): string {
  switch (m.kind) {
    case "price":
    case "funding":
      return m.kind;
    case "change":
      return `change${m.window}`;
    case "rsi":
    case "ema":
    case "sma":
    case "atr":
      return `${m.kind}(${m.length},${m.tf})`;
    case "macd":
      return `macd(${m.fast},${m.slow},${m.signal},${m.tf}).${m.line}`;
    case "bb":
      return `bb(${m.length},${m.mult},${m.tf}).${m.band}`;
    case "stoch":
      return `stoch(${m.length},${m.smooth},${m.tf}).${m.line}`;
    case "volume":
      return `volume(${m.tf})`;
  }
}

/** The metric as a person reads it: "RSI 14 · 1h". */
export function metricLabel(m: Metric): string {
  const tf = (t: Interval) => t.replace("h", "H").replace("d", "D");
  switch (m.kind) {
    case "price":
      return "Price";
    case "funding":
      return "Funding";
    case "change":
      return `${m.window} change`;
    case "rsi":
      return `RSI ${m.length} · ${tf(m.tf)}`;
    case "ema":
    case "sma":
      return `${m.kind.toUpperCase()} ${m.length} · ${tf(m.tf)}`;
    case "atr":
      return `ATR ${m.length} · ${tf(m.tf)}`;
    case "macd":
      return `MACD ${m.line === "macd" ? "line" : m.line === "signal" ? "signal" : "histogram"} ${m.fast},${m.slow},${m.signal} · ${tf(m.tf)}`;
    case "bb":
      return `Bollinger ${m.band} ${m.length},${m.mult} · ${tf(m.tf)}`;
    case "stoch":
      return `Stochastic %${m.line.toUpperCase()} ${m.length},${m.smooth} · ${tf(m.tf)}`;
    case "volume":
      return `Volume · ${tf(m.tf)}`;
  }
}

/** The unit of a metric's values, for the threshold's field. */
export function metricUnit(m: Metric): "price" | "%" | "index" | "volume" {
  switch (m.kind) {
    case "change":
    case "funding":
      return "%";
    case "rsi":
    case "stoch":
      return "index";
    case "volume":
      return "volume";
    case "macd":
      return "price";
    default:
      return "price";
  }
}

/** Metrics whose value is a price: comparable with each other. */
export const isPriceLike = (m: Metric): boolean => ["price", "ema", "sma", "bb"].includes(m.kind);

const INT = (min: number, max: number) => (s: string | undefined, fallback: number) => {
  if (s === undefined || s === "") return fallback;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const LENGTH = INT(2, 500);
const tfOf = (s: string | undefined): Interval | null => {
  const t = (s ?? "1h").toLowerCase();
  return (TIMEFRAMES as string[]).includes(t) ? (t as Interval) : null;
};

/** A metric from its text, or why it cannot be one. */
export function parseMetric(text: string): Metric | { error: string } {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "price") return { kind: "price" };
  if (t === "funding") return { kind: "funding" };
  const ch = /^change(1h|4h|24h|7d)$/.exec(t);
  if (ch) return { kind: "change", window: ch[1] as ChangeWindow };
  const m = /^(rsi|ema|sma|atr|macd|bb|stoch|volume)(?:\(([^)]*)\))?(?:\.(\w+))?$/.exec(t);
  if (!m) return { error: `Unknown metric "${text.trim()}".` };
  const kind = m[1];
  const args = m[2] ? m[2].split(",") : [];
  const part = m[3];
  /* The timeframe is the last argument when it is one. */
  const tfArg = args.length && /[a-z]$/.test(args[args.length - 1]) ? args.pop() : undefined;
  const tf = tfOf(tfArg);
  if (!tf) return { error: `Timeframe of "${text.trim()}": 15m, 1h, 4h or 1d.` };
  const bad = (what: string) => ({ error: `${what} in "${text.trim()}".` });
  switch (kind) {
    case "rsi":
    case "ema":
    case "sma":
    case "atr": {
      if (part) return bad(`No ".${part}"`);
      const length = LENGTH(args[0], kind === "rsi" || kind === "atr" ? 14 : 20);
      if (!Number.isFinite(length) || args.length > 1) return bad("Expected (length, timeframe)");
      return { kind, length, tf } as Metric;
    }
    case "volume":
      if (args.length || part) return bad("Expected volume(timeframe)");
      return { kind: "volume", tf };
    case "macd": {
      const [fast, slow, signal] = [LENGTH(args[0], 12), LENGTH(args[1], 26), LENGTH(args[2], 9)];
      const line = part ?? "hist";
      if (![fast, slow, signal].every(Number.isFinite) || fast >= slow || args.length > 3) return bad("Expected (fast, slow, signal, timeframe) with fast < slow");
      if (line !== "macd" && line !== "signal" && line !== "hist") return bad("MACD reads .macd, .signal or .hist");
      return { kind: "macd", fast, slow, signal, tf, line };
    }
    case "bb": {
      const length = LENGTH(args[0], 20);
      const mult = args[1] === undefined || args[1] === "" ? 2 : Number(args[1]);
      if (!Number.isFinite(length) || !(mult > 0 && mult <= 5) || args.length > 2) return bad("Expected (length, deviations, timeframe)");
      if (part !== "upper" && part !== "middle" && part !== "lower") return bad("Bollinger reads .upper, .middle or .lower");
      return { kind: "bb", length, mult, tf, band: part };
    }
    case "stoch": {
      const [length, smooth] = [LENGTH(args[0], 14), INT(1, 50)(args[1], 3)];
      const line = part ?? "k";
      if (!Number.isFinite(length) || !Number.isFinite(smooth) || args.length > 2) return bad("Expected (length, smoothing, timeframe)");
      if (line !== "k" && line !== "d") return bad("Stochastic reads .k or .d");
      return { kind: "stoch", length, smooth, tf, line };
    }
  }
  return { error: `Unknown metric "${text.trim()}".` };
}

/** An indicator's value at the last candle; null: not enough candles. */
export function compute(m: Metric, candles: Candle[]): number | null {
  switch (m.kind) {
    case "rsi":
      return rsi(candles, m.length);
    case "ema":
      return ema(candles, m.length);
    case "sma":
      return sma(candles, m.length);
    case "atr":
      return atr(candles, m.length);
    case "macd":
      return macd(candles, m.fast, m.slow, m.signal)?.[m.line] ?? null;
    case "bb":
      return bollinger(candles, m.length, m.mult)?.[m.band] ?? null;
    case "stoch":
      return stochastic(candles, m.length, m.smooth)?.[m.line] ?? null;
    case "volume":
      return candles.length ? candles[candles.length - 1].v : null;
    default:
      return null;
  }
}
