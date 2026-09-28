import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "./client";
import { placeOrderTool } from "./place-order";
import { closePositionTool } from "./close-position";
import { transferTool } from "./transfer";
import { watchTool } from "./watch";
import { MAIN, TESTNET, ccxtError, ctx, fakeExchange } from "./test-fixture";

/* The audit's findings on the action tools (audit 4, code review A1, A2,
   N1, N2, N3): each test failed before its fix. */

vi.mock("./client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);

beforeEach(() => mocked.mockReset());

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls;

describe("A1: an action is never sent twice", () => {
  test("PlaceOrder: a timeout on createOrder is NOT retried; the outcome is said unknown, with the client id to look for", async () => {
    const ex = fakeExchange({
      createOrder: vi.fn(async () => {
        throw ccxtError("RequestTimeout", "binance POST https://api.binance.com/api/v3/order request timed out (10000 ms)");
      }),
    });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 200 }, ctx());
    expect(calls(ex.createOrder)).toHaveLength(1);
    expect(r.ok).toBe(false);
    const sent = calls(ex.createOrder)[0][5] as { clientOrderId?: string };
    expect(sent.clientOrderId).toMatch(/^bnai[0-9a-f]{12}$/);
    expect(r.output).toMatch(/^Outcome UNKNOWN/);
    expect(r.output).toContain(sent.clientOrderId as string);
    expect(r.output).toMatch(/Do NOT place it again/);
    expect(r.output).toMatch(/ExchangeOrders/);
  });
  test("PlaceOrder: a transient error on a read BEFORE the send is still retried (nothing was sent yet)", async () => {
    let n = 0;
    const ex = fakeExchange({
      fetchTicker: vi.fn(async () => {
        if (n++ === 0) throw ccxtError("NetworkError", "socket hang up");
        return { symbol: "BTC/USDT", last: 50000 };
      }),
    });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 200 }, ctx());
    expect(r.ok).toBe(true);
    expect(calls(ex.fetchTicker)).toHaveLength(2);
    expect(calls(ex.createOrder)).toHaveLength(1);
  });
  test("PlaceOrder: a refusal (non-transient) keeps its plain-English message", async () => {
    mocked.mockResolvedValue(fakeExchange({ createOrder: vi.fn(async () => { throw ccxtError("InvalidOrder", "-1013"); }) }));
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.01 }, ctx());
    expect(r.output).toBe("Order refused by the exchange. Exchange: -1013");
  });
  test("Transfer: a NetworkError on transfer is NOT retried; check the balances first", async () => {
    const ex = fakeExchange({ transfer: vi.fn(async () => { throw ccxtError("NetworkError", "socket hang up"); }) });
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "USDT", amount: 100, from: "spot", to: "futures" }, ctx());
    expect(calls(ex.transfer)).toHaveLength(1);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Outcome UNKNOWN: the transfer of 100 USDT spot → futures/);
    expect(r.output).toMatch(/ExchangeBalance/);
  });
  test("ClosePosition: a timeout on the close order is NOT retried; check the position first", async () => {
    const ex = fakeExchange({
      fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1 }]),
      createOrder: vi.fn(async () => { throw ccxtError("RequestTimeout", "timed out"); }),
    });
    mocked.mockResolvedValue(ex);
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx());
    expect(calls(ex.createOrder)).toHaveLength(1);
    expect(r.output).toMatch(/^Outcome UNKNOWN/);
    expect(r.output).toMatch(/ExchangePositions/);
  });
  test("HTX futures take only a numeric client id: none is sent there", async () => {
    const ex = fakeExchange({ id: "htx" });
    mocked.mockResolvedValue(ex);
    const htx = { ...MAIN, exchange: "htx", label: "HTX-main" };
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([htx]));
    expect(calls(ex.createOrder)[0][5]).not.toHaveProperty("clientOrderId");
  });
});

describe("A2: contract markets are sized in contracts", () => {
  /* OKX BTC-USDT-SWAP: 1 contract = 0.01 BTC, lot 0.01 contract. */
  const okxMarkets = (ex: ReturnType<typeof fakeExchange>) => {
    const m = (ex.markets as Record<string, Record<string, unknown>>)["BTC/USDT:USDT"];
    m.contractSize = 0.01;
    m.contract = true;
    m.limits = { amount: { min: 0.01 } };
    return ex;
  };
  const okx = { ...MAIN, exchange: "okx", label: "OKX-main", password: "p" };

  test("ClosePosition: 10 contracts (0.1 BTC) are closed as 10 contracts, said in both units", async () => {
    const ex = fakeExchange({
      id: "okx",
      amountToPrecision: (_s: string, a: number) => String(Math.floor(a * 100) / 100),
      fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 10, contractSize: 0.01 }]),
      createOrder: vi.fn(async () => ({ id: "c9", status: "closed" })),
    });
    mocked.mockResolvedValue(okxMarkets(ex));
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx([okx]));
    expect(calls(ex.createOrder)[0][3]).toBe(10);
    expect(r.output).toBe("Position BTC/USDT:USDT LONG closed at 100 % (0.1 BTC = 10 contracts) · order #c9 closed");
  });
  test("ClosePosition: half of 10 contracts is 5 contracts", async () => {
    const ex = fakeExchange({
      id: "okx",
      amountToPrecision: (_s: string, a: number) => String(Math.floor(a * 100) / 100),
      fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", side: "short", contracts: 10, contractSize: 0.01 }]),
    });
    mocked.mockResolvedValue(okxMarkets(ex));
    await closePositionTool.execute({ symbol: "BTC/USDT", fraction: 0.5 }, ctx([okx]));
    expect(calls(ex.createOrder)[0].slice(0, 4)).toEqual(["BTC/USDT:USDT", "market", "buy", 5]);
  });
  test("PlaceOrder amount 0.1 BTC on a 0.01 BTC contract: 10 contracts sent, both units in the answer", async () => {
    const ex = fakeExchange({
      id: "okx",
      amountToPrecision: (_s: string, a: number) => String(Math.floor(a * 100 + 1e-9) / 100),
      createOrder: vi.fn(async () => ({ id: "o7", status: "closed", amount: 10, filled: 10, average: 50000 })),
    });
    mocked.mockResolvedValue(okxMarkets(ex));
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.1 }, ctx([okx]));
    expect(calls(ex.createOrder)[0][3]).toBe(10);
    expect(r.output).toBe("Order #o7 closed · BUY 0.1 BTC (10 contracts) BTC/USDT:USDT market · average 50000 · filled 0.1 BTC (10 contracts)");
  });
  test("PlaceOrder quoteAmount 500 USDT at 50000 on a 0.01 BTC contract: 1 contract", async () => {
    const ex = fakeExchange({ id: "okx", amountToPrecision: (_s: string, a: number) => String(Math.floor(a * 100 + 1e-9) / 100) });
    mocked.mockResolvedValue(okxMarkets(ex));
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", quoteAmount: 500 }, ctx([okx]));
    expect(calls(ex.createOrder)[0][3]).toBe(1);
  });
  test("PlaceOrder below one lot after conversion: refused in both units, no call", async () => {
    const ex = fakeExchange({ id: "okx", amountToPrecision: (_s: string, a: number) => String(Math.floor(a * 100 + 1e-9) / 100) });
    mocked.mockResolvedValue(okxMarkets(ex));
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.00005 }, ctx([okx]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Quantity 0.00005 BTC = 0.005 contracts (1 contract = 0.01 BTC): below the market minimum (0.01 contracts = 0.0001 BTC).");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("N1: triggerDirection only where ccxt reads it", () => {
  test("Binance spot and futures stop orders carry no triggerDirection", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx());
    expect(calls(ex.createOrder)[0][5]).not.toHaveProperty("triggerDirection");
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx());
    expect(calls(ex.createOrder)[1][5]).not.toHaveProperty("triggerDirection");
  });
  test("OKX and Gate: none either", async () => {
    for (const id of ["okx", "gate"]) {
      const ex = fakeExchange({ id });
      mocked.mockResolvedValue(ex);
      await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([{ ...MAIN, exchange: id, label: id }]));
      expect(calls(ex.createOrder)[0][5]).not.toHaveProperty("triggerDirection");
    }
  });
  test("Bybit futures and KuCoin futures: sent", async () => {
    const bybit = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(bybit);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "stop", amount: 0.01, stopPrice: 55000 }, ctx([TESTNET]));
    expect(calls(bybit.createOrder)[0][5]).toMatchObject({ triggerDirection: "ascending" });
    const kucoin = fakeExchange({ id: "kucoinfutures" });
    mocked.mockResolvedValue(kucoin);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([{ ...MAIN, exchange: "kucoin", label: "KuCoin", password: "p" }]));
    expect(calls(kucoin.createOrder)[0][5]).toMatchObject({ triggerDirection: "descending" });
  });
});

describe("N2: quoteAmount converts at the order's own price", () => {
  test("limit: 200 USDT at a 40000 limit is 0.005 BTC, not 200 / last", async () => {
    const ex = fakeExchange(); // last = 50000
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "limit", price: 40000, quoteAmount: 200 }, ctx());
    expect(calls(ex.createOrder)[0][3]).toBe(0.005);
    expect(ex.fetchTicker).not.toHaveBeenCalled();
  });
  test("stop (market on trigger): converted at the trigger price", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", stopPrice: 40000, quoteAmount: 200 }, ctx());
    expect(calls(ex.createOrder)[0][3]).toBe(0.005);
  });
});

describe("N3: ExchangeWatch never reads a missing price as 0", () => {
  test("no `last`: the bid/ask midpoint, and `price<60000` does not fire", async () => {
    vi.useFakeTimers();
    try {
      const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: undefined, bid: 65000, ask: 65001 })) });
      mocked.mockResolvedValue(ex);
      const p = watchTool.execute({ symbol: "BTC/USDT", until: "price<60000", every: 5, timeout: 5000 }, ctx());
      await vi.advanceTimersByTimeAsync(6000);
      const r = await p;
      expect(r.output).not.toMatch(/condition `price<60000` reached/);
      expect(r.output).toMatch(/mark 65000\.5/);
    } finally {
      vi.useRealTimers();
    }
  });
  test("no price at all: the reading is skipped, never a condition fired on it", async () => {
    vi.useFakeTimers();
    try {
      const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: undefined })) });
      mocked.mockResolvedValue(ex);
      const p = watchTool.execute({ symbol: "BTC/USDT", until: "price<60000", every: 5, timeout: 20000 }, ctx());
      await vi.advanceTimersByTimeAsync(21000);
      const r = await p;
      expect(r.output).not.toMatch(/reached/);
      expect(r.output).toMatch(/reading missed: the ticker carries no price/);
    } finally {
      vi.useRealTimers();
    }
  });
  test("no `last` but a `close`: the close is the price", async () => {
    vi.useFakeTimers();
    try {
      const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: undefined, close: 59000 })) });
      mocked.mockResolvedValue(ex);
      const p = watchTool.execute({ symbol: "BTC/USDT", until: "price<60000", every: 5, timeout: 5000 }, ctx());
      await vi.advanceTimersByTimeAsync(1000);
      const r = await p;
      expect(r.output).toMatch(/condition `price<60000` reached/);
    } finally {
      vi.useRealTimers();
    }
  });
});
