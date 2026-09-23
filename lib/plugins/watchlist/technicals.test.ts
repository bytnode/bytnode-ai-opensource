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

  it("reads the last value of each, and the MACD's streak", () => {
    expect(readTechnicals(response)).toEqual({ rsi: 62.3, ema50: 111_000, ema200: 105_500, atr: 950, macd: { histogram: 1, bars: 3 } });
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
