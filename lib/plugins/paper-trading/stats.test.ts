import { describe, expect, it } from "vitest";
import type { Fill } from "./engine";
import { drawdown, isClosing, tradeStats } from "./stats";

const fill = (over: Partial<Fill>): Fill => ({ id: "f", orderId: "o", at: "2026-09-24T10:00:00.000Z", symbol: "BTC/USDT", market: "spot", side: "buy", amount: 0.01, price: 50_000, fee: 0.5, realizedPnl: 0, ...over });

describe("tradeStats", () => {
  it("counts what closed something: spot sales, futures results, liquidations", () => {
    expect(isClosing(fill({}))).toBe(false);
    expect(isClosing(fill({ side: "sell" }))).toBe(true);
    expect(isClosing(fill({ market: "futures", side: "sell" }))).toBe(false);
    expect(isClosing(fill({ market: "futures", realizedPnl: -3 }))).toBe(true);
    expect(isClosing(fill({ market: "futures", liquidation: true, realizedPnl: -40 }))).toBe(true);
  });

  it("wins, losses, best, worst, fees and volume", () => {
    const s = tradeStats([fill({}), fill({ side: "sell", realizedPnl: 30 }), fill({ side: "sell", realizedPnl: -10 }), fill({ side: "sell", realizedPnl: 50 }), fill({ market: "futures", liquidation: true, realizedPnl: -40, fee: 0 })]);
    expect(s).toMatchObject({ trades: 4, wins: 2, winRate: 50, best: 50, worst: -40, avgWin: 40, avgLoss: -25, fees: 2, volume: 2500, fills: 5 });
  });

  it("nothing closed yet: no rate, no extremes", () => {
    const s = tradeStats([fill({})]);
    expect([s.trades, s.wins, s.winRate, s.best, s.avgWin]).toEqual([0, 0, undefined, undefined, undefined]);
  });

  it("reads the deepest fall from a peak", () => {
    expect(drawdown([100, 120, 90, 130, 117])).toBeCloseTo(-25);
    expect(drawdown([100, 110, 120])).toBe(0);
    expect(drawdown([100])).toBeUndefined();
  });
});
