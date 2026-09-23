/* ---------------------------------------------------------------------------
   Candles, as the plugins use them: a series of OHLCV bars read from
   BytNode's klines (`{timestamp, open, high, low, close, volume, …}`,
   under `klines_<interval>` wherever the response nests it) or from an
   exchange's `fetchOHLCV` rows, and kept alive between two readings by
   the last price.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Interval = "15m" | "1h" | "4h" | "1d";

export const INTERVALS: Array<{ value: Interval; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

export const INTERVAL_MS: Record<Interval, number> = { "15m": 15 * 60_000, "1h": 3_600_000, "4h": 4 * 3_600_000, "1d": 86_400_000 };

export const isInterval = (v: unknown): v is Interval => typeof v === "string" && v in INTERVAL_MS;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** A time in ms: epoch seconds or ms, or an ISO date. */
function timeOf(v: unknown): number | undefined {
  const n = num(v);
  if (n !== undefined) return n < 1e12 ? n * 1000 : n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/** One bar from an object row or an `[t, o, h, l, c, v]` array; null when
    it is not one. */
export function toCandle(row: unknown): Candle | null {
  let t: number | undefined, o, h, l, c, v;
  if (Array.isArray(row)) {
    [t, o, h, l, c, v] = [timeOf(row[0]), num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5])];
  } else if (isRecord(row)) {
    t = timeOf(row.timestamp ?? row.open_time ?? row.time ?? row.t ?? row.bucket);
    [o, h, l, c, v] = [num(row.open ?? row.o), num(row.high ?? row.h), num(row.low ?? row.l), num(row.close ?? row.c), num(row.volume ?? row.v)];
  } else return null;
  if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) return null;
  return { t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: v ?? 0 };
}

/** The bars in order, oldest first, one per time. */
export function orderCandles(rows: unknown[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const r of rows) {
    const c = toCandle(r);
    if (c) byTime.set(c.t, c);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** BytNode's klines under `key` (`klines_1h`…), wherever the response puts
    them; an empty list when there are none. */
export function readKlines(response: unknown, key: string): Candle[] {
  const found = find(response, key, 0);
  return Array.isArray(found) ? orderCandles(found) : [];
}

function find(v: unknown, key: string, depth: number): unknown {
  if (depth > 6) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = find(x, key, depth + 1);
      if (f !== undefined) return f;
    }
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  if (Array.isArray(v[key])) return v[key];
  for (const x of Object.values(v)) {
    const f = find(x, key, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}

/** The series with a live price in it: the last bar moves (close, high,
    low), or a new bar opens when its time has come. A price older than the
    last bar changes nothing. */
export function withTick(candles: Candle[], price: number, at: number, interval: Interval): Candle[] {
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(price) || at < last.t) return candles;
  const span = INTERVAL_MS[interval];
  if (at < last.t + span) {
    if (price === last.c && price <= last.h && price >= last.l) return candles;
    return [...candles.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
  }
  const t = last.t + Math.floor((at - last.t) / span) * span;
  return [...candles, { t, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 }];
}
