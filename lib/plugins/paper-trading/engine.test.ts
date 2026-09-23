import { describe, expect, it } from "vitest";
import { available, cancelOrders, checkBook, emptyBook, liquidationPrice, neededSymbols, placeOrder, valuation, type Book, type EngineConfig, type OrderInput } from "./engine";

const cfg: EngineConfig = { feeRate: 0.001, slippage: 0.0005, mmr: 0.005 };
const now = new Date("2026-09-23T10:00:00Z");
const counter = (prefix = "id") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** Places or throws: the tests' happy path. */
function place(book: Book, input: Partial<OrderInput>, px: number, ids = counter()) {
  const r = placeOrder(book, { symbol: "BTC/USDT", market: "spot", side: "buy", type: "market", ...input }, px, cfg, ids, now);
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("paper trading — spot", () => {
  it("a market buy pays the slippage and the fee; a sale realizes against the average cost", () => {
    const buy = place(emptyBook(10_000, now), { quoteAmount: 1000 }, 50_000);
    const price = 50_000 * 1.0005;
    expect(buy.fill).toMatchObject({ price, amount: 1000 / price, fee: 1 });
    expect(buy.book.balances.USDT).toBeCloseTo(8999, 8);
    expect(buy.book.balances.BTC).toBeCloseTo(1000 / price, 12);

    const sell = place(buy.book, { side: "sell", amount: buy.book.balances.BTC }, 60_000);
    const out = (1000 / price) * 60_000 * 0.9995;
    expect(sell.fill!.realizedPnl).toBeCloseTo(out - 1000, 8);
    expect(sell.book.balances.BTC).toBeUndefined();
    expect(sell.book.costs).toEqual({});
    expect(sell.book.balances.USDT).toBeCloseTo(8999 + out * 0.999, 8);
  });

  it("refuses what the portfolio cannot pay or does not hold, and what is not quoted in USDT", () => {
    const book = emptyBook(100, now);
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "spot", side: "buy", type: "market", quoteAmount: 500 }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/^Not enough USDT/) });
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "spot", side: "sell", type: "market", amount: 0.1 }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/^Not enough BTC/) });
    expect(placeOrder(book, { symbol: "ETH/BTC", market: "spot", side: "buy", type: "market", amount: 1 }, 0.05, cfg, counter(), now)).toMatchObject({ error: "The paper portfolio trades against USDT: use ETH/USDT." });
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "spot", side: "buy", type: "market", amount: 1, quoteAmount: 1 }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/not both/) });
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "spot", side: "buy", type: "market", quoteAmount: 0.5 }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/minimum/) });
  });

  it("a limit waits with its cash held, then fills at its price", () => {
    const placed = place(emptyBook(1000, now), { type: "limit", price: 40_000, quoteAmount: 800 }, 50_000);
    expect(placed.fill).toBeUndefined();
    expect(placed.order).toMatchObject({ status: "open", amount: 0.02, price: 40_000 });
    expect(available(placed.book, "USDT", cfg)).toBeCloseTo(1000 - 800 * 1.001, 8);
    /* The cash held cannot pay another order. */
    expect(placeOrder(placed.book, { symbol: "BTC/USDT", market: "spot", side: "buy", type: "market", quoteAmount: 300 }, 50_000, cfg, counter("m"), now)).toMatchObject({ error: expect.stringMatching(/^Not enough USDT/) });

    const later = new Date("2026-09-23T11:00:00Z");
    expect(checkBook(placed.book, new Map([["BTC/USDT", 41_000]]), cfg, counter(), later).events).toEqual([]);
    const { book, events } = checkBook(placed.book, new Map([["BTC/USDT", 39_000]]), cfg, counter(), later);
    expect(events).toMatchObject([{ kind: "filled", fill: { price: 40_000, amount: 0.02, fee: 0.8 } }]);
    expect(book.balances).toEqual({ USDT: 1000 - 800.8, BTC: 0.02 });
    expect(book.orders[0]).toMatchObject({ status: "filled", closedAt: later.toISOString() });
  });

  it("a limit the market already passed fills at once, never worse than its price", () => {
    const r = place(emptyBook(1000, now), { type: "limit", price: 60_000, amount: 0.01 }, 50_000);
    expect(r.fill?.price).toBe(50_000 * 1.0005);
    const capped = place(emptyBook(1000, now), { type: "limit", price: 50_010, amount: 0.01 }, 50_000);
    expect(capped.fill?.price).toBe(50_010);
  });

  it("cancels one order or all of them, and frees what they held", () => {
    let book = place(emptyBook(1000, now), { type: "limit", price: 40_000, amount: 0.01 }, 50_000).book;
    book = place(book, { type: "limit", price: 30_000, amount: 0.01 }, 50_000, counter("b")).book;
    const one = cancelOrders(book, "id1", now);
    expect("book" in one && one.cancelled.map((o) => o.id)).toEqual(["id1"]);
    const all = cancelOrders(book, "all", now);
    expect("book" in all && available(all.book, "USDT", cfg)).toBe(1000);
    expect(cancelOrders(emptyBook(1, now), "all", now)).toEqual({ error: "No open paper order." });
  });
});

describe("paper trading — futures", () => {
  const fut = (input: Partial<OrderInput>): Partial<OrderInput> => ({ market: "futures", ...input });

  it("opens with a margin, adds at an average price, closes with its result", () => {
    const zero: EngineConfig = { ...cfg, slippage: 0 };
    const go = (book: Book, input: Partial<OrderInput>, px: number) => {
      const r = placeOrder(book, { symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", ...input }, px, zero, counter(), now);
      if ("error" in r) throw new Error(r.error);
      return r;
    };
    let r = go(emptyBook(10_000, now), { amount: 0.1, leverage: 5 }, 50_000);
    expect(r.book.positions).toMatchObject([{ side: "long", amount: 0.1, entryPrice: 50_000, leverage: 5, margin: 1000 }]);
    expect(r.book.balances.USDT).toBeCloseTo(10_000 - 1000 - 5, 8);
    r = go(r.book, { amount: 0.1 }, 60_000);
    expect(r.book.positions[0]).toMatchObject({ amount: 0.2, entryPrice: 55_000, margin: 2200 });
    r = go(r.book, { side: "sell", amount: 0.2 }, 56_000);
    expect(r.fill!.realizedPnl).toBeCloseTo(200, 8);
    expect(r.book.positions).toEqual([]);
    expect(r.book.balances.USDT).toBeCloseTo(10_000 + 200 - r.book.fees, 8);
  });

  it("flips, reduces only when asked, refuses a new leverage on an open position", () => {
    let book = place(emptyBook(10_000, now), fut({ side: "sell", amount: 0.1, leverage: 2 }), 50_000).book;
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "futures", side: "sell", type: "market", amount: 0.1, leverage: 10 }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/is at ×2/) });
    const reduce = place(book, fut({ side: "buy", amount: 0.5, reduceOnly: true }), 50_000);
    expect(reduce.fill?.amount).toBe(0.1);
    expect(reduce.book.positions).toEqual([]);
    book = place(book, fut({ side: "buy", amount: 0.3 }), 50_000).book;
    expect(book.positions).toMatchObject([{ side: "long", amount: expect.closeTo(0.2, 12), leverage: 2 }]);
    expect(placeOrder(book, { symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.1, reduceOnly: true }, 50_000, cfg, counter(), now)).toMatchObject({ error: expect.stringMatching(/no short BTC\/USDT position/) });
  });

  it("liquidates a position the price crossed: the margin is lost", () => {
    const { book } = place(emptyBook(10_000, now), fut({ amount: 1, leverage: 10 }), 50_000);
    const liq = liquidationPrice(book.positions[0], cfg);
    expect(liq).toBeLessThan(50_000 * 0.91);
    expect(checkBook(book, new Map([["BTC/USDT", liq + 1]]), cfg, counter(), now).events).toEqual([]);
    const { book: after, events } = checkBook(book, new Map([["BTC/USDT", liq - 1]]), cfg, counter(), now);
    expect(events).toMatchObject([{ kind: "liquidated", fill: { liquidation: true, price: liq } }]);
    expect(after.positions).toEqual([]);
    expect(after.balances.USDT).toBe(book.balances.USDT);
    expect(after.realizedPnl).toBeCloseTo(-book.positions[0].margin, 8);
  });
});

describe("paper trading — valuation", () => {
  it("values holdings and positions, and gives no total while a price is missing", () => {
    let book = place(emptyBook(10_000, now), { amount: 0.1 }, 50_000).book;
    book = place(book, { market: "futures", symbol: "ETH/USDT", side: "sell", amount: 1, leverage: 3 }, 2000).book;
    expect(neededSymbols(book).sort()).toEqual(["BTC/USDT", "ETH/USDT"]);
    const partial = valuation(book, new Map([["BTC/USDT", 55_000]]), cfg);
    expect(partial.equity).toBeUndefined();
    expect(partial.missing).toEqual(["ETH/USDT"]);
    const v = valuation(book, new Map([["BTC/USDT", 55_000], ["ETH/USDT", 1900]]), cfg);
    expect(v.holdings[0]).toMatchObject({ asset: "BTC", value: 5500 });
    expect(v.positions[0].unrealized).toBeCloseTo((2000 * 0.9995 - 1900) * 1, 8);
    expect(v.equity).toBeCloseTo(v.cash + 5500 + v.positions[0].margin + v.positions[0].unrealized!, 8);
    expect(v.returnPct).toBeCloseTo(((v.equity! - 10_000) / 10_000) * 100, 8);
  });

  it("the same orders at the same prices give the same result, to the cent", () => {
    const run = () => {
      let book = emptyBook(5000, now);
      const ids = counter();
      for (const [input, px] of [
        [{ quoteAmount: 1000 }, 50_000],
        [{ market: "futures", side: "sell", amount: 0.05, leverage: 4 }, 51_000],
        [{ side: "sell", amount: 0.01 }, 52_500],
        [{ market: "futures", side: "buy", amount: 0.05 }, 49_000],
      ] as Array<[Partial<OrderInput>, number]>) {
        book = place(book, input, px, ids).book;
      }
      return valuation(book, new Map([["BTC/USDT", 50_500]]), cfg);
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.equity!.toFixed(2)).toBe(run().equity!.toFixed(2));
  });
});
