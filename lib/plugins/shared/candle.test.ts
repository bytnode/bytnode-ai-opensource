import { describe, expect, it } from "vitest";
import { orderCandles, readKlines, toCandle, withTick } from "./candle";

const H = 3_600_000;

describe("toCandle", () => {
  it("reads BytNode's rows, in seconds, ms or ISO", () => {
    expect(toCandle({ timestamp: 1_700_000_000, open: 1, high: 3, low: 0.5, close: 2, volume: 10 })).toEqual({ t: 1_700_000_000_000, o: 1, h: 3, l: 0.5, c: 2, v: 10 });
    expect(toCandle({ timestamp: "2026-09-23T10:00:00Z", open: "1", high: "2", low: "1", close: "2" })?.t).toBe(Date.parse("2026-09-23T10:00:00Z"));
    expect(toCandle({ open_time: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1 })?.t).toBe(1_700_000_000_000);
  });

  it("reads an exchange's array rows", () => {
    expect(toCandle([1_700_000_000_000, 1, 2, 0.5, 1.5, 7])).toEqual({ t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 7 });
  });

  it("keeps high and low around open and close", () => {
    expect(toCandle({ timestamp: 1, open: 5, high: 4, low: 6, close: 5 })).toMatchObject({ h: 5, l: 5 });
  });

  it("refuses what is not a bar", () => {
    expect(toCandle({ timestamp: 1, open: 1 })).toBeNull();
    expect(toCandle("x")).toBeNull();
  });
});

describe("orderCandles / readKlines", () => {
  it("orders oldest first and keeps one bar per time", () => {
    const rows = [
      { timestamp: 3 * H, open: 3, high: 3, low: 3, close: 3 },
      { timestamp: 1 * H, open: 1, high: 1, low: 1, close: 1 },
      { timestamp: 3 * H, open: 4, high: 4, low: 4, close: 4 },
    ];
    expect(orderCandles(rows).map((c) => c.c)).toEqual([1, 4]);
  });

  it("finds the klines wherever the response nests them", () => {
    const res = { symbol: "ETHUSDT", data: { klines_1h: [{ timestamp: H, open: 1, high: 2, low: 1, close: 2, volume: 3 }] } };
    expect(readKlines(res, "klines_1h")).toHaveLength(1);
    expect(readKlines(res, "klines_4h")).toEqual([]);
    expect(readKlines(null, "klines_1h")).toEqual([]);
  });
});

describe("withTick", () => {
  const base = [{ t: 0, o: 10, h: 12, l: 9, c: 11, v: 5 }];

  it("moves the last bar within its time", () => {
    expect(withTick(base, 13, H / 2, "1h")).toEqual([{ t: 0, o: 10, h: 13, l: 9, c: 13, v: 5 }]);
    expect(withTick(base, 8, H / 2, "1h")[0]).toMatchObject({ l: 8, c: 8 });
  });

  it("opens a new bar when its time has come, aligned on the interval", () => {
    const next = withTick(base, 12, 2 * H + 60_000, "1h");
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ t: 2 * H, o: 11, h: 12, l: 11, c: 12, v: 0 });
  });

  it("changes nothing for an unchanged or stale price, or an empty series", () => {
    expect(withTick(base, 11, H / 2, "1h")).toBe(base);
    expect(withTick(base, 20, -1, "1h")).toBe(base);
    expect(withTick([], 20, 0, "1h")).toEqual([]);
  });
});
