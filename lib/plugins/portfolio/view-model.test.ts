import { describe, expect, it } from "vitest";
import { allocation, dailySeries } from "./view-model";

const snap = (date: string, totalUsd: number) => ({ date, at: `${date}T23:55:00Z`, totalUsd, assets: {} });
const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe("dailySeries", () => {
  it("draws one bar a day, in the chosen currency, a missing day carrying the day before", () => {
    const bars = dailySeries([snap("2026-09-20", 100), snap("2026-09-23", 130), snap("2026-09-21", 110)], 0.5);
    expect(bars.map((b) => [b.t, b.c])).toEqual([
      [day("2026-09-20"), 50],
      [day("2026-09-21"), 55],
      [day("2026-09-22"), 55],
      [day("2026-09-23"), 65],
    ]);
    expect(bars[0]).toMatchObject({ o: 50, h: 50, l: 50, v: 0 });
  });

  it("is empty without a snapshot", () => {
    expect(dailySeries([], 1)).toEqual([]);
  });
});

describe("allocation", () => {
  const assets = ["BTC", "ETH", "SOL", "USDT", "DOGE"].map((asset, i) => ({ asset, amount: 1, usd: 50 - i * 10, share: (50 - i * 10) / 150 }));

  it("keeps a short list as it is", () => {
    expect(allocation(assets, 5).map((s) => s.asset)).toEqual(["BTC", "ETH", "SOL", "USDT", "DOGE"]);
  });

  it("folds the rest into Other", () => {
    const slices = allocation(assets, 3);
    expect(slices.map((s) => s.asset)).toEqual(["BTC", "ETH", "Other"]);
    expect(slices[2]).toMatchObject({ usd: 60, count: 3 });
    expect(slices[2].share).toBeCloseTo(60 / 150);
  });
});
