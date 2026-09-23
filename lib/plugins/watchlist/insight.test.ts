import { describe, expect, it } from "vitest";
import { compact, readInsight } from "./insight";

const H = 3_600_000;

describe("readInsight", () => {
  const response = {
    symbol: "ETHUSDT",
    data: {
      klines_1h: [
        { timestamp: 2 * H, open: 10, high: 12, low: 9, close: 11, volume: 100, taker_buy: 60, taker_sell: 40 },
        { timestamp: 1 * H, open: 9, high: 10, low: 8, close: 10, volume: 50, taker_buy: 20, taker_sell: 30 },
      ],
      tokenomics: { circulating_supply: 120, total_supply: 120, max_supply: null, market_cap: 1320, fdv: 1320 },
      funding_next: { estimated_rate: 0.0001, apr: 10.95, settlement_at: "2026-09-24T08:00:00Z", is_past: false },
      oi_snapshots: [{ oi_total: 1000, timestamp: "2026-09-24T00:00:00Z" }],
      "ls_ratio@1h": [{ part_long: 0.62, ratio: 1.63 }],
      liq_cumulative: [
        { timestamp: "2026-09-23T10:00:00Z", long_usd: 100, short_usd: 20, total_usd: 120 },
        { timestamp: "2026-09-23T10:05:00Z", long_usd: 50, short_usd: 30, total_usd: 80 },
      ],
    },
  };

  it("reads every block of one answer", () => {
    const i = readInsight(response, 11);
    expect(i.range).toEqual({ low: 8, high: 12 });
    expect(i.volumeUsd).toBe(100 * 11 + 50 * 10);
    expect(i.buyShare).toBeCloseTo(80 / 150);
    expect(i.marketCap).toBe(1320);
    expect(i.supplyShare).toBe(1);
    expect(i.funding).toBeCloseTo(0.01);
    expect(i.fundingApr).toBe(10.95);
    expect(i.fundingAt).toBe("2026-09-24T08:00:00Z");
    expect(i.oiUsd).toBe(11_000);
    expect(i.longShare).toBe(0.62);
    expect(i.liqLongUsd).toBe(150);
    expect(i.liqShortUsd).toBe(50);
  });

  it("shows only what there is", () => {
    expect(readInsight({ data: { tokenomics: null, funding_next: { estimated_rate: null } } }, 1)).toEqual({});
    expect(readInsight(null, 1)).toEqual({});
  });

  it("does not price the open interest without a price", () => {
    expect(readInsight(response, undefined).oiUsd).toBeUndefined();
  });
});

describe("compact", () => {
  it("shortens large amounts", () => {
    expect(compact(1_240_000_000)).toBe("1.24 B");
    expect(compact(612_400_000)).toBe("612 M");
    expect(compact(48_200)).toBe("48.2 K");
    expect(compact(950)).toBe("950");
    expect(compact(undefined)).toBe("—");
  });
});
