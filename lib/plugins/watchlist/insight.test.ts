import { describe, expect, it } from "vitest";
import { compact, readInsight } from "./insight";

const H = 3_600_000;

describe("readInsight", () => {
  const T = (h: number) => new Date(h * H).toISOString();
  const response = {
    symbol: "ETHUSDT",
    data: {
      "klines@1h": [
        { time: T(2), open: 10, high: 12, low: 9, close: 11, volume_spot: 40, buy_volume_spot: 30, sell_volume_spot: 10, volume_futures: 60, volume_total: 100 },
        { time: T(1), open: 9, high: 10, low: 8, close: 10, volume_spot: 20, buy_volume_spot: 6, sell_volume_spot: 14, volume_futures: 30, volume_total: 50 },
      ],
      tokenomics: { time: T(2), circulating_supply: 120, total_supply: 120, max_supply: null, price: 11, market_cap_usd: 1320, fdv_usd: 1320 },
      funding_next: { time: "2026-09-24T08:00:00.000Z", estimated_rate_pct: 0.01, apr_pct: 10.95, is_past: false },
      "oi_history@1h": [{ time: "2026-09-24T00:00:00.000Z", oi_total: 1000, is_closed: true }],
      "ls_ratio@1h": [{ part_long: 0.62, ratio: 1.63 }],
      heatmap_clusters: { time: T(2), density_up: 5, dist_up: 0.012, density_down: 9, dist_down: 0.02, attraction_up: 34722, attraction_down: 22500 },
      orderbook: {
        time: T(2),
        is_closed: true,
        ranges: [
          { range_pct: 0.25, imbalance: 0.5 },
          { range_pct: 1, imbalance: 0.2 },
          { range_pct: 5, imbalance: -0.4 },
        ],
      },
      buysell_ratio: { buy_volume: 55, sell_volume: 45, buy_ratio: 0.55 },
      "liquidations_cumulative@5m": [
        { time: "2026-09-23T10:05:00.000Z", long_usd: 100, short_usd: 20, total_usd: 120 },
        { time: "2026-09-23T10:10:00.000Z", long_usd: 50, short_usd: 30, total_usd: 80 },
      ],
    },
  };

  it("reads every block of one answer", () => {
    const i = readInsight(response, 11);
    expect(i.range).toEqual({ low: 8, high: 12 });
    expect(i.volumeUsd).toBe(100 * 11 + 50 * 10);
    expect(i.buyShare).toBeCloseTo(36 / 60);
    expect(i.marketCap).toBe(1320);
    expect(i.supplyShare).toBe(1);
    expect(i.funding).toBeCloseTo(0.01);
    expect(i.fundingApr).toBe(10.95);
    expect(i.fundingAt).toBe("2026-09-24T08:00:00.000Z");
    expect(i.oiUsd).toBe(11_000);
    expect(i.longShare).toBe(0.62);
    expect(i.liqLongUsd).toBe(150);
    expect(i.liqShortUsd).toBe(50);
    expect(i.magnetUp).toEqual({ dist: 0.012, pull: 34722 });
    expect(i.magnetDown).toEqual({ dist: 0.02, pull: 22500 });
    expect(i.bookImbalance).toBe(0.2);
    expect(i.flowBuyShare).toBe(0.55);
  });

  it("shows only what there is", () => {
    expect(readInsight({ data: { tokenomics: null, funding_next: { estimated_rate_pct: null } } }, 1)).toEqual({});
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
