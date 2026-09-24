import { describe, expect, it } from "vitest";
import { assetsOf, estimateHistory, mergeHistory } from "./backfill";

const D = 86_400_000;
const t0 = Date.parse("2026-09-20T00:00:00Z");
const bars = (closes: number[], from = t0) => closes.map((c, i) => ({ t: from + i * D, o: c, h: c, l: c, c, v: 0 }));

describe("estimateHistory", () => {
  const holdings = [
    { id: "a", assets: [{ asset: "BTC", amount: 0.5 }, { asset: "USDT", amount: 100 }] },
    { id: "b", assets: [{ asset: "ETH", amount: 2 }, { asset: "XYZ", amount: 9 }] },
  ];

  it("values today's holdings at each day's close, per account and in all", () => {
    const { points, missing } = estimateHistory(holdings, { BTC: bars([100, 120, 110]), ETH: bars([10, 11, 12]) });
    expect(missing).toEqual(["XYZ"]);
    expect(points.map((p) => [p.date, p.totalUsd, p.accounts])).toEqual([
      ["2026-09-20", 170, { a: 150, b: 20 }],
      ["2026-09-21", 182, { a: 160, b: 22 }],
      ["2026-09-22", 179, { a: 155, b: 24 }],
    ]);
    expect(points[0].estimated).toBe(true);
  });

  it("keeps only the days every priced asset has", () => {
    const { points } = estimateHistory(holdings, { BTC: bars([100, 120, 110]), ETH: bars([11, 12], t0 + D) });
    expect(points.map((p) => p.date)).toEqual(["2026-09-21", "2026-09-22"]);
  });

  it("lists the assets to find", () => {
    expect(assetsOf(holdings)).toEqual(["BTC", "ETH", "XYZ"]);
  });
});

describe("mergeHistory", () => {
  it("puts a real snapshot in place of its estimated day", () => {
    const est = [{ date: "2026-09-21", at: "", totalUsd: 1, assets: {} }, { date: "2026-09-22", at: "", totalUsd: 2, assets: {} }];
    const real = [{ date: "2026-09-22", at: "", totalUsd: 5, assets: {} }, { date: "2026-09-23", at: "", totalUsd: 6, assets: {} }];
    expect(mergeHistory(real, est).map((p) => [p.date, p.totalUsd])).toEqual([
      ["2026-09-21", 1],
      ["2026-09-22", 5],
      ["2026-09-23", 6],
    ]);
  });
});
