import { describe, expect, it } from "vitest";
import { liquidation, positionSize, riskReward, type LiquidationResult, type SizeResult } from "./calc";

/* Reference cases, computed by hand:
   - 10 000 capital, 1 % risk = 100; long 50 000 → stop 49 000: 1 000 of loss
     per BTC, so 0.1 BTC, 5 000 notional, leverage 0.5.
   - same, 0.06 % fees per side: loss per BTC = 1 000 + 0.0006 × 99 000 =
     1 059.4 → 100 / 1 059.4 = 0.094393…
   - isolated long 50 000 ×10, mmr 0.4 %: 50 000 × 0.9 / 0.996 = 45 180.72…;
     short: 50 000 × 1.1 / 1.004 = 54 780.88… */

describe("positionSize", () => {
  it("sizes so the loss at the stop is the risk", () => {
    const r = positionSize({ capital: 10_000, riskPercent: 1, entry: 50_000, stop: 49_000, side: "long" }) as SizeResult;
    expect(r.size).toBeCloseTo(0.1, 10);
    expect(r.notional).toBeCloseTo(5_000, 6);
    expect(r.leverage).toBeCloseTo(0.5, 10);
    expect(r.riskAmount).toBe(100);
    expect(r.stopDistancePct).toBeCloseTo(2, 10);
    expect(r.fees).toBe(0);
  });

  it("includes the fees of both sides", () => {
    const r = positionSize({ capital: 10_000, riskAmount: 100, entry: 50_000, stop: 49_000, side: "long", feeRate: 0.0006 }) as SizeResult;
    expect(r.size).toBeCloseTo(100 / 1059.4, 12);
    expect(r.size * 1000 + r.fees).toBeCloseTo(100, 9);
  });

  it("works for a short", () => {
    const r = positionSize({ capital: 2_000, riskAmount: 20, entry: 3_000, stop: 3_100, side: "short" }) as SizeResult;
    expect(r.size).toBeCloseTo(0.2, 12);
  });

  it("refuses what makes no sense", () => {
    expect(positionSize({ capital: 1_000, riskPercent: 1, entry: 100, stop: 101, side: "long" })).toEqual({ error: "For a long, the stop (101) must be below the entry (100)." });
    expect(positionSize({ capital: 1_000, riskPercent: 1, entry: 100, stop: 99, side: "short" })).toEqual({ error: "For a short, the stop (99) must be above the entry (100)." });
    expect(positionSize({ capital: 1_000, riskAmount: 1_500, entry: 100, stop: 99, side: "long" })).toEqual({ error: "The risk (1500) is larger than the capital (1000)." });
    expect(positionSize({ capital: 1_000, riskAmount: 10, riskPercent: 1, entry: 100, stop: 99, side: "long" })).toMatchObject({ error: expect.stringMatching(/not both/) });
    expect(positionSize({ capital: 0, riskPercent: 1, entry: 100, stop: 99, side: "long" })).toMatchObject({ error: expect.stringMatching(/positive/) });
    expect(positionSize({ capital: 1_000, riskPercent: 1, entry: 100, stop: 99, side: "long", feeRate: 0.05 })).toMatchObject({ error: expect.stringMatching(/feeRate/) });
  });
});

describe("liquidation", () => {
  it("isolated, long and short", () => {
    const long = liquidation({ side: "long", entry: 50_000, leverage: 10, mmr: 0.004, mode: "isolated" }) as LiquidationResult;
    expect(long.price).toBeCloseTo((50_000 * 0.9) / 0.996, 6);
    expect(long.distancePct).toBeCloseTo(-9.6386, 3);
    const short = liquidation({ side: "short", entry: 50_000, leverage: 10, mmr: 0.004, mode: "isolated" }) as LiquidationResult;
    expect(short.price).toBeCloseTo((50_000 * 1.1) / 1.004, 6);
  });

  it("cross: the whole collateral backs the position", () => {
    /* 1 BTC long at 50 000 backed by 10 000: (50 000 − 10 000) / 0.995. */
    const r = liquidation({ side: "long", entry: 50_000, size: 1, collateral: 10_000, mmr: 0.005, mode: "cross" }) as LiquidationResult;
    expect(r.price).toBeCloseTo(40_000 / 0.995, 6);
    expect(liquidation({ side: "long", entry: 50_000, size: 1, collateral: 60_000, mmr: 0.005, mode: "cross" })).toEqual({ error: "No liquidation price: the collateral covers a fall to zero." });
  });

  it("asks for what the mode needs", () => {
    expect(liquidation({ side: "long", entry: 100, mmr: 0.005, mode: "isolated" })).toMatchObject({ error: expect.stringMatching(/leverage/) });
    expect(liquidation({ side: "long", entry: 100, mmr: 0.005, mode: "cross", size: 1 })).toMatchObject({ error: expect.stringMatching(/collateral/) });
    expect(liquidation({ side: "long", entry: 100, leverage: 5, mmr: 0.6, mode: "isolated" })).toMatchObject({ error: expect.stringMatching(/maintenance/) });
  });
});

describe("riskReward", () => {
  it("the ratio per target and the break-even win rate", () => {
    const r = riskReward({ side: "long", entry: 100, stop: 95, targets: [110, 115] });
    expect(r).toEqual({
      risk: 5,
      rows: [
        { target: 110, reward: 10, ratio: 2, breakevenWinRate: 1 / 3 },
        { target: 115, reward: 15, ratio: 3, breakevenWinRate: 0.25 },
      ],
    });
  });

  it("fees lower the reward and raise the risk", () => {
    const r = riskReward({ side: "short", entry: 100, stop: 105, targets: [90], feeRate: 0.001 });
    if ("error" in r) throw new Error(r.error);
    expect(r.risk).toBeCloseTo(5.205, 12);
    expect(r.rows[0].reward).toBeCloseTo(9.81, 12);
  });

  it("refuses a target behind the entry", () => {
    expect(riskReward({ side: "long", entry: 100, stop: 95, targets: [99] })).toEqual({ error: "The target 99 is not on the winning side of the entry (100) for a long." });
    expect(riskReward({ side: "long", entry: 100, stop: 95, targets: [] })).toEqual({ error: "Give at least one target." });
  });
});
