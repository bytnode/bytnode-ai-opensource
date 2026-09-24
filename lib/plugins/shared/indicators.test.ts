import { describe, expect, it } from "vitest";
import type { Candle } from "./candle";
import { atr, bollinger, ema, macd, rsi, sma, stochastic } from "./indicators";

const bars = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i * 60_000, o: c, h: c + 1, l: c - 1, c, v: 10 }));

/* Wilder's own example (New Concepts in Technical Trading Systems, the
   14-day RSI table as reproduced by StockCharts). */
const WILDER = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];

describe("indicators", () => {
  it("moving averages", () => {
    const c = bars([1, 2, 3, 4, 5, 6]);
    expect(sma(c, 3)).toBe(5);
    /* Seeded with the SMA of 1,2,3 = 2, then k = 0.5: 3, 4, 5. */
    expect(ema(c, 3)).toBe(5);
    expect(sma(c, 7)).toBeNull();
    expect(ema(bars([10, 10, 10, 10]), 2)).toBe(10);
  });

  it("RSI, as Wilder computes it", () => {
    /* StockCharts prints 70.53: it rounds the averages first. */
    expect(rsi(bars(WILDER.slice(0, 15)), 14)).toBeCloseTo(70.46, 2);
    expect(rsi(bars(WILDER), 14)).toBeCloseTo(57.92, 0);
    expect(rsi(bars([1, 2, 3, 4]), 3)).toBe(100);
    expect(rsi(bars([5, 5, 5, 5]), 3)).toBe(50);
    expect(rsi(bars([1, 2, 3]), 3)).toBeNull();
  });

  it("MACD: the line, its signal, the gap", () => {
    const rising = bars(Array.from({ length: 60 }, (_, i) => 100 + i));
    const m = macd(rising, 12, 26, 9)!;
    /* A straight line: the EMAs lag by a constant, the gap closes. */
    expect(m.macd).toBeCloseTo(7, 5);
    expect(m.hist).toBeCloseTo(0, 5);
    expect(macd(bars([1, 2, 3]), 12, 26, 9)).toBeNull();
  });

  it("Bollinger bands, stochastic, ATR", () => {
    const b = bollinger(bars([2, 4, 4, 4, 5, 5, 7, 9]), 8, 2)!;
    expect(b).toEqual({ upper: 9, middle: 5, lower: 1 });
    const s = stochastic(bars([10, 11, 12, 13, 14]), 3, 2)!;
    /* Each close sits 1 under a high of the window's top bar. */
    expect(s.k).toBeCloseTo(75, 5);
    expect(s.d).toBeCloseTo(75, 5);
    expect(atr(bars([10, 10, 10, 10, 10]), 3)).toBe(2);
    expect(atr(bars([10, 10]), 3)).toBeNull();
  });
});
