import { describe, expect, it } from "vitest";
import { samplePoints, sampleSummary } from "./sample";

describe("sample data", () => {
  const s = sampleSummary();

  it("adds up like a real summary: testnet apart, shares of the whole", () => {
    const live = s.accounts.filter((a) => !a.testnet).reduce((t, a) => t + a.usd, 0);
    expect(s.totalUsd).toBeCloseTo(live, 6);
    expect(s.testnetUsd).toBe(15_000);
    expect(s.assets.reduce((t, a) => t + a.share, 0)).toBeCloseTo(1, 10);
    expect(s.wallets.spot + s.wallets.futures + s.wallets.funding).toBeCloseTo(s.totalUsd, 6);
    expect(s.unrealizedPnl).toBeCloseTo(669.6 - 378 + 264, 6);
  });

  it("draws a year of days ending on today's total, the same every time", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const points = samplePoints(now);
    expect(points).toHaveLength(365);
    expect(points.at(-1)).toMatchObject({ date: "2026-09-24", totalUsd: Math.round(s.totalUsd * 100) / 100 });
    expect(points[0].date).toBe("2025-09-25");
    expect(samplePoints(now)).toEqual(points);
  });
});
