import { describe, expect, it } from "vitest";
import { emptyBook, type Book, type Fill } from "./engine";
import { intervalFor, resultCurve } from "./curve";

const fill = (at: string, realizedPnl: number, fee: number): Fill => ({ id: at, orderId: "o", at, symbol: "BTC/USDT", market: "spot", side: "sell", amount: 1, price: 1, fee, realizedPnl });

function book(createdAt: string, fills: Fill[]): Book {
  const b = emptyBook(1000, new Date(createdAt));
  return { ...b, fills, realizedPnl: fills.reduce((t, f) => t + f.realizedPnl, 0), fees: fills.reduce((t, f) => t + f.fee, 0) };
}

describe("resultCurve", () => {
  it("picks its bucket from the span", () => {
    expect(intervalFor(3 * 3_600_000)).toBe("15m");
    expect(intervalFor(30 * 3_600_000)).toBe("1h");
    expect(intervalFor(10 * 86_400_000)).toBe("1d");
  });

  it("adds each closed trade, net of its fee, day by day, and closes on the equity", () => {
    const b = book("2026-09-01T09:00:00.000Z", [fill("2026-09-02T10:00:00.000Z", 50, 1), fill("2026-09-02T15:00:00.000Z", -20, 1), fill("2026-09-04T08:00:00.000Z", 0, 2)]);
    const { interval, candles } = resultCurve(b, new Date("2026-09-05T12:00:00.000Z"), 1100);
    expect(interval).toBe("1d");
    expect(candles.map((c) => c.c)).toEqual([1000, 1028, 1028, 1026, 1100]);
    expect(candles[1]).toMatchObject({ o: 1000, h: 1049, l: 1000, c: 1028 });
    expect(candles[0].t).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
  });

  it("stays flat before the oldest fill the book still keeps", () => {
    /* The totals include a fill trimmed from the book: +100 earlier. */
    const b = { ...book("2026-09-01T00:00:00.000Z", [fill("2026-09-03T10:00:00.000Z", 10, 0)]), realizedPnl: 110 };
    const { candles } = resultCurve(b, new Date("2026-09-04T01:00:00.000Z"));
    expect(candles.map((c) => c.c)).toEqual([1100, 1100, 1110, 1110]);
  });

  it("keeps the most recent buckets only", () => {
    const { candles } = resultCurve(book("2024-01-01T00:00:00.000Z", []), new Date("2026-09-01T00:00:00.000Z"));
    expect(candles).toHaveLength(365);
    expect(candles[364].t).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
  });
});
