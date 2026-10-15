/* ---------------------------------------------------------------------------
   The chosen asset's technical signals, on the chart's interval: ONE
   `POST /v1/indicators` (BytNode's REST API; `INDICATORS`, the last
   `RESULTS` bars) — RSI 14, EMA 50 and 200, ATR 14, MACD 12/26/9 — read
   into what the tab says: the RSI's zone, the trend against the two
   averages, the volatility as a share of the price, and which side the
   MACD is on and for how many bars. BytNode computes them on the same
   candles as `/v1/klines/history`; the body asks `limit` values per
   indicator, and the answer's `data` is `{ indicators: { <id>: { values:
   [{time, value} | {time, macd, signal, histogram}] } } }`, MOST RECENT
   FIRST (contract 4.x; the body's `results` and the bare number lists
   oldest first are gone — the latter is still read).
   Pure, tested.
--------------------------------------------------------------------------- */

export const RESULTS = 30;

/** Our own names for the results (BytNode keys `data.indicators` by them;
    1-64 letters, digits, `_`, `-`, `.`). */
export const INDICATORS = [
  { id: "rsi_mid", type: "rsi", period: 14 },
  { id: "ema_mid", type: "ema", period: 50 },
  { id: "ema_slow", type: "ema", period: 200 },
  { id: "atr_mid", type: "atr", period: 14 },
  { id: "macd", type: "macd", fast: 12, slow: 26, signal: 9 },
];

export type Technicals = {
  rsi?: number;
  ema50?: number;
  ema200?: number;
  atr?: number;
  /** The last MACD histogram, and for how many bars it has kept its sign. */
  macd?: { histogram: number; bars: number };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** An indicator's entry, wherever the response nests it. */
function entry(v: unknown, id: string, depth = 0): Record<string, unknown> | undefined {
  if (depth > 6) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = entry(x, id, depth + 1);
      if (f) return f;
    }
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  if (isRecord(v[id]) && "values" in (v[id] as Record<string, unknown>)) return v[id] as Record<string, unknown>;
  for (const x of Object.values(v)) {
    const f = entry(x, id, depth + 1);
    if (f) return f;
  }
  return undefined;
}

const last = (xs: number[]) => (xs.length ? xs[xs.length - 1] : undefined);

/** One output of an indicator, oldest first: rows `{time, <output>}` (put
    in time order, the API sends the most recent first), or the former bare
    lists (a number list, or `{<output>: [...]}`), already oldest first. */
function series(values: unknown, output: string): number[] {
  if (isRecord(values)) return nums(values[output]);
  if (!Array.isArray(values)) return [];
  if (!values.some(isRecord)) return nums(values);
  const at = (r: Record<string, unknown>) => Date.parse(String(r.time ?? "")) || 0;
  return values
    .filter(isRecord)
    .sort((a, b) => at(a) - at(b))
    .map((r) => num(r[output]))
    .filter((x): x is number => x !== undefined);
}

export function readTechnicals(response: unknown): Technicals {
  const out: Technicals = {};
  const scalar = (id: string) => last(series(entry(response, id)?.values, "value"));
  out.rsi = scalar("rsi_mid");
  out.ema50 = scalar("ema_mid");
  out.ema200 = scalar("ema_slow");
  out.atr = scalar("atr_mid");
  const hist = series(entry(response, "macd")?.values, "histogram");
  const h = last(hist);
  if (h !== undefined) {
    let bars = 0;
    for (let i = hist.length - 1; i >= 0 && Math.sign(hist[i]) === Math.sign(h); i--) bars++;
    out.macd = { histogram: h, bars };
  }
  for (const k of Object.keys(out) as Array<keyof Technicals>) if (out[k] === undefined) delete out[k];
  return out;
}

export type Zone = "oversold" | "neutral" | "overbought";
export const rsiZone = (rsi: number): Zone => (rsi <= 30 ? "oversold" : rsi >= 70 ? "overbought" : "neutral");

export type Trend = "up" | "down" | "mixed";
/** Above both averages: up; below both: down; between: mixed. */
export function trendOf(price: number, ema50: number, ema200: number): Trend {
  if (price > ema50 && price > ema200) return "up";
  if (price < ema50 && price < ema200) return "down";
  return "mixed";
}
