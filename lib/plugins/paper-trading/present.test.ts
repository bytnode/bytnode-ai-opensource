import { describe, expect, it } from "vitest";
import { emptyBook, type Fill, type PaperOrder } from "./engine";
import { SIMULATED, exportSections, fillLine, orderLine, paperPrompt, portfolioLines } from "./present";

const order: PaperOrder = { id: "o1", createdAt: "", symbol: "BTC/USDT", market: "futures", side: "sell", type: "limit", amount: 0.05, price: 65_000, leverage: 3, reduceOnly: true, status: "open" };
const fill: Fill = { id: "f1", orderId: "o1", at: "2026-09-23T10:05:00.000Z", symbol: "BTC/USDT", market: "futures", side: "sell", amount: 0.05, price: 65_000, fee: 3.25, realizedPnl: -12.5 };

describe("paper trading in words", () => {
  it("an order, a fill, a liquidation", () => {
    expect(orderLine(order)).toBe("sell 0.05 BTC/USDT (futures ×3, reduce-only) limit 65000 [o1]");
    expect(fillLine(fill)).toBe("2026-09-23 10:05 UTC — sell 0.05 BTC/USDT (futures) at 65000, fee 3.25 USDT, realized −12.50 USDT");
    expect(fillLine({ ...fill, liquidation: true, fee: 0 })).toMatch(/— LIQUIDATED BTC\/USDT at 65000, fee 0\.00 USDT/);
  });

  it("always says it is simulated", () => {
    const book = emptyBook(10_000, new Date("2026-09-23T00:00:00Z"));
    const v = { cash: 10_000, free: 10_000, holdings: [], positions: [], equity: 10_000, unrealized: 0, missing: [], realized: 0, fees: 0, returnPct: 0 };
    expect(portfolioLines(book, v, new Date("2026-09-23T10:00:00Z"))[0]).toContain(SIMULATED);
    expect(paperPrompt([{ name: "Main", book }])).toMatch(/^## Paper trading\nA simulated portfolio \(capital 10 000\.00 USDT.*\n.*never present it as a real performance/);
    expect(paperPrompt([{ name: "Main", book }, { name: "Swing", book }])).toContain("2 simulated portfolios; PaperOrder / PaperCancel / PaperPortfolio take `portfolio` (by name), the first is the default:\n- Main (default): capital 10 000.00 USDT");
    expect(exportSections(book, v)[0]).toMatchObject({ heading: "Simulated result", markdown: expect.stringContaining(SIMULATED) });
    expect(portfolioLines(book, { ...v, equity: undefined, missing: ["ETH/USDT"] }, new Date())[1]).toBe("Equity: unknown, no price for ETH/USDT. Cash 10 000.00 USDT.");
  });

  it("the cash open orders hold back is not shown as free", () => {
    const book = emptyBook(10_000, new Date("2026-09-23T00:00:00Z"));
    const v = { cash: 10_000, free: 9_600, holdings: [], positions: [], equity: 10_000, unrealized: 0, missing: [], realized: 0, fees: 0, returnPct: 0 };
    expect(portfolioLines(book, v, new Date())[1]).toBe("Equity 10 000.00 USDT for a capital of 10 000.00 USDT (+0.00 USDT, 0.00 %). Cash 10 000.00 USDT, of which 400.00 USDT held by open orders: 9 600.00 USDT free to trade.");
    expect(paperPrompt([{ name: "Main", book, free: 9_600 }])).toContain("cash 10 000.00 USDT (9 600.00 USDT free, the rest held by open orders)");
  });
});
