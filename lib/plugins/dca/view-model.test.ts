import { describe, expect, it } from "vitest";
import { frequencyOf, frequencyWords, nextDue, planFigures, sumFigures, unitOf, type PlanRow } from "./view-model";

const row = (id: string, symbol: string, invested: number, amount: number, extra: Partial<PlanRow> = {}): PlanRow => ({
  id,
  symbol,
  quoteAmount: 100,
  frequency: "daily at 09:00",
  destination: "paper",
  startAt: "",
  status: "active",
  createdAt: "",
  summary: { purchases: amount > 0 ? 2 : 0, invested, amount, ...(amount > 0 ? { average: invested / amount } : {}), pending: 0 },
  ...extra,
});

describe("figures", () => {
  it("values a plan at the current price", () => {
    const f = planFigures(row("a", "BTC/USDT", 200, 0.004), 60_000);
    expect(f.value).toBe(240);
    expect(f.pnl).toBeCloseTo(40);
    expect(f.pct).toBeCloseTo(20);
    expect(f.average).toBe(50_000);
  });

  it("adds plans, and gives no value while one that bought has no price", () => {
    const a = planFigures(row("a", "BTC/USDT", 200, 0.004), 60_000);
    const b = planFigures(row("b", "SOL/USDT", 100, 1), undefined);
    const idle = planFigures(row("c", "ETH/USDT", 0, 0), undefined);
    expect(sumFigures([a, idle]).value).toBe(240);
    expect(sumFigures([a, b]).value).toBeUndefined();
    expect(sumFigures([a, b]).invested).toBe(300);
  });

  it("counts in the shared quote, else in USD", () => {
    expect(unitOf([row("a", "BTC/USDT", 0, 0), row("b", "ETH/USDT", 0, 0)])).toBe("USDT");
    expect(unitOf([row("a", "BTC/USDT", 0, 0), row("b", "ETH/USDC", 0, 0)])).toBe("USD");
  });

  it("finds the soonest due date of the active plans", () => {
    expect(nextDue([row("a", "BTC/USDT", 0, 0, { nextDue: "2026-09-30T07:00:00Z" }), row("b", "BTC/USDT", 0, 0, { nextDue: "2026-09-25T07:00:00Z" }), row("c", "BTC/USDT", 0, 0, { nextDue: "2026-09-20T07:00:00Z", status: "paused" })])).toBe("2026-09-25T07:00:00Z");
  });
});

describe("the form's frequency", () => {
  it("writes the plans' words", () => {
    expect(frequencyOf({ kind: "daily", time: "08:30" })).toBe("daily at 08:30");
    expect(frequencyOf({ kind: "weekly", weekday: "monday", time: "09:00" })).toBe("every monday at 09:00");
    expect(frequencyOf({ kind: "days", days: 14 })).toBe("every 14 days");
    expect(frequencyOf({ kind: "days", days: 1 })).toBe("every 1 day");
  });

  it("reads them back in a sentence", () => {
    expect(frequencyWords("every monday at 09:00")).toBe("every Monday at 09:00");
    expect(frequencyWords("daily at 08:00")).toBe("Every day at 08:00");
  });
});
