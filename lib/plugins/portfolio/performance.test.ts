import { describe, expect, it } from "vitest";
import { dailyReturns, dayReturn, performance, slicePeriod } from "./performance";

const D = 86_400_000;
const series = (values: number[]) => values.map((c, i) => ({ t: i * D, o: c, h: c, l: c, c, v: 0 }));

describe("slicePeriod", () => {
  it("keeps the period's days and the day before them", () => {
    const s = series(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(slicePeriod(s, "7d").map((b) => b.c)).toEqual([33, 34, 35, 36, 37, 38, 39, 40]);
    expect(slicePeriod(s, "90d")).toHaveLength(40);
  });
});

describe("dailyReturns", () => {
  it("measures each day against the day before", () => {
    expect(dailyReturns(series([100, 110, 99])).map((m) => Number(m.pct.toFixed(2)))).toEqual([10, -10]);
  });
});

describe("performance", () => {
  const p = performance(series([100, 120, 90, 110, 130]))!;

  it("reads the return, the high and the low", () => {
    expect(p).toMatchObject({ start: 100, end: 130, change: 30, high: 130, low: 90, days: 4 });
    expect(p.pct).toBeCloseTo(30, 10);
  });

  it("finds the deepest fall from a high", () => {
    /* 120 → 90 */
    expect(p.maxDrawdown).toBeCloseTo(-25);
  });

  it("names the best and the worst day", () => {
    /* 90 → 110 beats 100 → 120 */
    expect(p.best?.t).toBe(3 * D);
    expect(p.best?.pct).toBeCloseTo(22.22, 1);
    expect(p.worst?.t).toBe(2 * D);
    expect(p.worst?.pct).toBeCloseTo(-25);
  });

  it("annualizes the volatility of the daily moves", () => {
    expect(p.volatility).toBeGreaterThan(0);
    expect(performance(series([100, 101]))?.volatility).toBeNull();
  });

  it("takes the deposits and withdrawals off the performance", () => {
    /* 100 → 150 with 50 deposited on day 1: no gain; then +10 %. */
    const bars = [100, 150, 165].map((c, i) => ({ t: i * D, o: c, h: c, l: c, c, v: i === 1 ? 50 : 0 }));
    const q = performance(bars)!;
    expect(q.change).toBeCloseTo(15);
    expect(q.pct).toBeCloseTo(10);
    expect(dailyReturns(bars).map((m) => Number(m.pct.toFixed(2)))).toEqual([0, 10]);
    expect(q.maxDrawdown).toBe(0);
  });

  it("counts a day's deposit half in the base", () => {
    /* 40 held, 2000 deposited, 2060 at the close: +20 on about 1040. */
    expect(dayReturn(40, 2060, 2000)).toBeCloseTo((20 / 1040) * 100);
    /* The first deposit on an empty account. */
    expect(dayReturn(0, 2000, 2000)).toBe(0);
    expect(dayReturn(0, 50)).toBeUndefined();
  });

  it("measures the value's own fall apart from the performance's", () => {
    /* 600 → 40: 550 spent on day 2 (a flow), then −2.5 % on day 3. */
    const bars = [600, 50, 48.75].map((c, i) => ({ t: i * D, o: c, h: c, l: c, c, v: i === 1 ? -550 : 0 }));
    const q = performance(bars)!;
    expect(q.maxDrawdown).toBeCloseTo(-2.5);
    expect(q.valueDrawdown).toBeCloseTo(-91.875);
    expect(q.valueChange).toBeCloseTo(-551.25);
    expect(q.moneyOut).toBe(-550);
    expect(q.moneyIn).toBe(0);
    expect(q.change).toBeCloseTo(-1.25);
    expect([q.highAt, q.lowAt]).toEqual([0, 2 * D]);
  });

  it("needs two days", () => {
    expect(performance(series([100]))).toBeNull();
    expect(performance(series([100, 100]))?.maxDrawdown).toBe(0);
  });
});
