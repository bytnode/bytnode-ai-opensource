import { describe, expect, it } from "vitest";
import { dailyReturns, performance, slicePeriod } from "./performance";

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
    expect(p).toMatchObject({ start: 100, end: 130, change: 30, pct: 30, high: 130, low: 90, days: 4 });
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

  it("needs two days", () => {
    expect(performance(series([100]))).toBeNull();
    expect(performance(series([100, 100]))?.maxDrawdown).toBe(0);
  });
});
