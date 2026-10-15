import { describe, expect, it } from "vitest";
import { readTechnicals, rsiZone, trendOf } from "./technicals";

describe("readTechnicals", () => {
  const response = {
    status: "ok",
    data: {
      symbol: "BTCUSDT",
      timeframe: "1h",
      indicators: {
        rsi_mid: { type: "rsi", period: 14, values: [48.2, 62.3] },
        ema_mid: { type: "ema", period: 50, values: [110_000, 111_000] },
        ema_slow: { type: "ema", period: 200, values: [105_000, 105_500] },
        atr_mid: { type: "atr", period: 14, values: [900, 950] },
        macd: { type: "macd", values: { macd: [1, 2, 3, 4], signal: [0, 0, 0, 0], histogram: [-3, 2, 5, 1] } },
      },
    },
  };

  it("reads the last value of each, and the MACD's streak (the former bare lists)", () => {
    expect(readTechnicals(response)).toEqual({ rsi: 62.3, ema50: 111_000, ema200: 105_500, atr: 950, macd: { histogram: 1, bars: 3 } });
  });

  it("reads contract 4.x rows, most recent first", () => {
    const T = (h: number) => new Date(Date.UTC(2026, 9, 15, h)).toISOString();
    const rows = (xs: number[]) => xs.map((value, i) => ({ time: T(10 - i), value }));
    const current = {
      status: "ok",
      data_type: "indicators",
      symbol: "BTCUSDT",
      timeframe: "1h",
      data: {
        indicators: {
          rsi_mid: { type: "rsi", period: 14, values: rows([62.3, 48.2]) },
          ema_mid: { type: "ema", period: 50, values: rows([111_000, 110_000]) },
          ema_slow: { type: "ema", period: 200, values: rows([105_500, 105_000]) },
          atr_mid: { type: "atr", period: 14, values: rows([950, 900]) },
          macd: { type: "macd", fast: 12, slow: 26, signal: 9, values: [1, 5, 2, -3].map((histogram, i) => ({ time: T(10 - i), macd: 4 - i, signal: 0, histogram })) },
        },
      },
    };
    expect(readTechnicals(current)).toEqual({ rsi: 62.3, ema50: 111_000, ema200: 105_500, atr: 950, macd: { histogram: 1, bars: 3 } });
  });

  it("keeps only what is there", () => {
    expect(readTechnicals({ data: { indicators: { rsi_mid: { values: [null] } } } })).toEqual({});
    expect(readTechnicals("x")).toEqual({});
  });
});

describe("zones", () => {
  it("names the RSI's zone", () => {
    expect(rsiZone(25)).toBe("oversold");
    expect(rsiZone(50)).toBe("neutral");
    expect(rsiZone(75)).toBe("overbought");
  });

  it("reads the trend against both averages", () => {
    expect(trendOf(12, 10, 11)).toBe("up");
    expect(trendOf(9, 10, 11)).toBe("down");
    expect(trendOf(10.5, 10, 11)).toBe("mixed");
  });
});
