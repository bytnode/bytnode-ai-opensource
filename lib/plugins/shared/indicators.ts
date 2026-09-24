import type { Candle } from "./candle";

/* ---------------------------------------------------------------------------
   Technical indicators computed from candles, the textbook way — so an
   alert can watch "RSI 14 on the hour" whatever length or timeframe the
   user picks (BytNode's own indicators come in three fixed flavours).

     sma, ema          moving averages of the close (the EMA seeded with
                       the SMA of its first `length` closes)
     rsi               Wilder's RSI
     macd              EMA(fast) − EMA(slow), its EMA(signal), and the gap
     bollinger         SMA ± mult × population standard deviation
     stochastic        %K over `length` bars, %D its SMA(smooth)
     atr               Wilder's average true range

   Each returns the value at the LAST candle, or null when there are not
   enough candles for it to mean anything. Pure, tested.
--------------------------------------------------------------------------- */

const closes = (c: Candle[]) => c.map((x) => x.c);

function smaSeries(values: number[], length: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    out.push(i >= length - 1 ? sum / length : null);
  }
  return out;
}

function emaSeries(values: number[], length: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (length + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) out.push(null);
    else if (prev === null) {
      prev = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
      out.push(prev);
    } else {
      prev = values[i] * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

export function sma(candles: Candle[], length: number): number | null {
  if (candles.length < length) return null;
  return last(smaSeries(closes(candles), length)) ?? null;
}

export function ema(candles: Candle[], length: number): number | null {
  if (candles.length < length) return null;
  return last(emaSeries(closes(candles), length)) ?? null;
}

export function rsi(candles: Candle[], length: number): number | null {
  const c = closes(candles);
  if (c.length <= length) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= length;
  loss /= length;
  for (let i = length + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (length - 1) + Math.max(d, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-d, 0)) / length;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export type Macd = { macd: number; signal: number; hist: number };

export function macd(candles: Candle[], fast: number, slow: number, signal: number): Macd | null {
  const c = closes(candles);
  if (c.length < slow + signal - 1) return null;
  const f = emaSeries(c, fast);
  const s = emaSeries(c, slow);
  const line: number[] = [];
  for (let i = 0; i < c.length; i++) if (f[i] !== null && s[i] !== null) line.push(f[i]! - s[i]!);
  const sig = last(emaSeries(line, signal));
  const m = last(line);
  if (sig === null || sig === undefined || m === undefined) return null;
  return { macd: m, signal: sig, hist: m - sig };
}

export type Bands = { upper: number; middle: number; lower: number };

export function bollinger(candles: Candle[], length: number, mult: number): Bands | null {
  if (candles.length < length) return null;
  const window = closes(candles).slice(-length);
  const middle = window.reduce((a, b) => a + b, 0) / length;
  const sd = Math.sqrt(window.reduce((a, b) => a + (b - middle) ** 2, 0) / length);
  return { upper: middle + mult * sd, middle, lower: middle - mult * sd };
}

export type Stoch = { k: number; d: number };

export function stochastic(candles: Candle[], length: number, smooth: number): Stoch | null {
  if (candles.length < length + smooth - 1) return null;
  const ks: number[] = [];
  for (let i = length - 1; i < candles.length; i++) {
    const w = candles.slice(i - length + 1, i + 1);
    const hi = Math.max(...w.map((x) => x.h));
    const lo = Math.min(...w.map((x) => x.l));
    ks.push(hi === lo ? 50 : ((candles[i].c - lo) / (hi - lo)) * 100);
  }
  const d = last(smaSeries(ks, smooth));
  const k = last(ks);
  if (d === null || d === undefined || k === undefined) return null;
  return { k, d };
}

export function atr(candles: Candle[], length: number): number | null {
  if (candles.length <= length) return null;
  const tr = candles.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - candles[i].c), Math.abs(x.l - candles[i].c)));
  let value = tr.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < tr.length; i++) value = (value * (length - 1) + tr[i]) / length;
  return value;
}
