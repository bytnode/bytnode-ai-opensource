import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "./client";
import { balanceTool } from "./balance";
import { positionsTool } from "./positions";
import { ordersTool } from "./orders";
import { tickerTool } from "./ticker";
import { MAIN, TESTNET, ccxtError, ctx, fakeExchange } from "./test-fixture";

vi.mock("./client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);

beforeEach(() => mocked.mockReset());

describe("ExchangeBalance", () => {
  test("balances with USD estimate: stable at 1, quoted via fetchTickers, unpriced market left out", async () => {
    const ex = fakeExchange({
      fetchBalance: vi.fn(async (params?: { type?: string }) =>
        params?.type ? { total: {}, free: {}, used: {} } : { total: { USDT: 2000, BTC: 0.05, DOGE: 10, ZERO: 0 }, free: { USDT: 1500, BTC: 0.05, DOGE: 10 }, used: { USDT: 500, BTC: 0, DOGE: 0 } },
      ),
      fetchTickers: vi.fn(async () => ({ "BTC/USDT": { last: 67432 } })),
    });
    mocked.mockResolvedValue(ex);
    const r = await balanceTool.execute({}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe(
      ["Binance-main · spot", "USDT: 2000 (free 1500, locked 500) ≈ 2000 USD", "BTC: 0.05 (free 0.05) ≈ 3371.6 USD", "DOGE: 10 (free 10)", "Total ≈ 5371.6 USD (excluding unpriced assets)"].join("\n"),
    );
    expect(ex.fetchTickers).toHaveBeenCalledWith(["BTC/USDT"]);
  });
  test("Funding wallet (Bybit): read separately, and reported when trading is empty", async () => {
    const ex = fakeExchange({
      id: "bybit",
      fetchBalance: vi.fn(async (params?: { type?: string }) =>
        params?.type === "funding" ? { total: { USDC: 40 }, free: { USDC: 40 }, used: {} } : { total: {}, free: {}, used: {} },
      ),
    });
    mocked.mockResolvedValue(ex);
    const r = await balanceTool.execute({}, ctx([TESTNET]));
    expect(ex.fetchBalance).toHaveBeenCalledWith({ type: "funding" });
    expect(r.output).toBe(
      ["Bybit-test · spot", "No balance.", "Funding wallet (outside trading): USDC: 40 (free 40) ≈ 40 USD", "These funds cannot be used for trading until they are transferred to the trading account (Transfer, from: funding)."].join("\n"),
    );
  });
  test("without a separate Funding wallet (Kraken): a single call", async () => {
    const ex = fakeExchange({ id: "kraken" });
    mocked.mockResolvedValue(ex);
    await balanceTool.execute({}, ctx([{ ...MAIN, exchange: "kraken", label: "Kraken-main" }]));
    expect(ex.fetchBalance).toHaveBeenCalledTimes(1);
  });
  test("key refused: readable error", async () => {
    mocked.mockResolvedValue(fakeExchange({ fetchBalance: vi.fn(async () => { throw ccxtError("AuthenticationError", "bad key"); }) }));
    const r = await balanceTool.execute({}, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("API key refused: check the account in Authentication (Test button). Exchange: bad key");
  });
  test("two accounts without `account`: error, no call", async () => {
    const r = await balanceTool.execute({}, ctx([MAIN, TESTNET]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Several accounts: specify `account` among Binance-main, Bybit-test.");
    expect(mocked).not.toHaveBeenCalled();
  });
  test("the futures market opens a futures client", async () => {
    mocked.mockResolvedValue(fakeExchange());
    await balanceTool.execute({ market: "futures" }, ctx());
    expect(mocked).toHaveBeenCalledWith(MAIN, "futures");
  });
});

describe("ExchangePositions", () => {
  test("always on futures, filtered by normalized symbol", async () => {
    const ex = fakeExchange({
      fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, leverage: 5, liquidationPrice: 52000, marginMode: "isolated" }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await positionsTool.execute({ symbol: "btc/usdt" }, ctx());
    expect(mocked).toHaveBeenCalledWith(MAIN, "futures");
    expect(ex.fetchPositions).toHaveBeenCalledWith(["BTC/USDT:USDT"]);
    expect(r.output).toBe("BTC/USDT:USDT · LONG 0.05 · entry 65000 · mark 67000 · PnL +100 (+3.08 %) · ×5 isolated · liquidation 52000 (−22.39 %)");
  });
  test("no position", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await positionsTool.execute({}, ctx())).output).toBe("No open position.");
  });
  test("unknown market", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await positionsTool.execute({ symbol: "XYZ/USDT" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Unknown market on binance: XYZ/USDT:USDT.");
  });
});

describe("ExchangeOrders", () => {
  test("open orders", async () => {
    const ex = fakeExchange({
      fetchOpenOrders: vi.fn(async () => [{ id: "123", symbol: "BTC/USDT", type: "limit", side: "buy", price: 60000, amount: 0.1, filled: 0.04, status: "open", timestamp: 1700000000000, fee: { cost: 0.12, currency: "USDT" } }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await ordersTool.execute({ status: "open", symbol: "BTC/USDT", since: "2023-11-01T00:00:00Z", limit: 10 }, ctx());
    expect(ex.fetchOpenOrders).toHaveBeenCalledWith("BTC/USDT", Date.parse("2023-11-01T00:00:00Z"), 10);
    expect(r.output).toBe("2023-11-14T22:13:20Z · #123 · BTC/USDT · BUY limit 0.1 @ 60000 · filled 0.04 · open · fee 0.12 USDT");
  });
  test("closed orders: falls back on fetchOrders when the exchange has no fetchClosedOrders", async () => {
    const ex = fakeExchange({
      has: { fetchClosedOrders: false },
      fetchOrders: vi.fn(async () => [{ id: "1", symbol: "BTC/USDT", type: "market", side: "sell", amount: 1, status: "closed", timestamp: 1700000000000 }, { id: "2", symbol: "BTC/USDT", type: "limit", side: "buy", amount: 1, status: "open" }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await ordersTool.execute({ status: "closed" }, ctx());
    expect(r.output).toBe("2023-11-14T22:13:20Z · #1 · BTC/USDT · SELL market 1 · closed");
  });
  test("no order", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await ordersTool.execute({ status: "open" }, ctx())).output).toBe("No order.");
  });
});

describe("ExchangeTicker", () => {
  test("futures: ticker, order book, funding", async () => {
    const ex = fakeExchange({
      fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT:USDT", last: 67000, bid: 66999, ask: 67001, baseVolume: 12345.6, percentage: 1.2 })),
      fetchOrderBook: vi.fn(async () => ({ bids: [[66999, 1.5], [66998, 2]], asks: [[67001, 0.8], [67002, 1]] })),
      fetchFundingRate: vi.fn(async () => ({ fundingRate: 0.0001, fundingTimestamp: 1700000000000 })),
    });
    mocked.mockResolvedValue(ex);
    const r = await tickerTool.execute({ symbol: "BTC/USDT", market: "futures", depth: 1 }, ctx());
    expect(ex.fetchOrderBook).toHaveBeenCalledWith("BTC/USDT:USDT", 20);
    expect(r.output).toBe(["BTC/USDT:USDT · last 67000 · bid 66999 / ask 67001 · 24 h +1.2 % · volume 12345.6", "Funding 0.01 % · next 2023-11-14T22:13:20Z", "Order book:", "  ask 67001 × 0.8", "  bid 66999 × 1.5"].join("\n"));
  });
  test("spot without order book: one line; a failing order book blocks nothing", async () => {
    const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: 50000 })), fetchOrderBook: vi.fn(async () => { throw ccxtError("NetworkError"); }) });

    mocked.mockResolvedValue(ex);
    expect((await tickerTool.execute({ symbol: "BTC/USDT", depth: 0 }, ctx())).output).toBe("BTC/USDT · last 50000 · bid – / ask – · 24 h – · volume –");
    expect(ex.fetchOrderBook).not.toHaveBeenCalled();
    expect((await tickerTool.execute({ symbol: "BTC/USDT" }, ctx())).output).toBe("BTC/USDT · last 50000 · bid – / ask – · 24 h – · volume –");
    expect(ex.fetchFundingRate).not.toHaveBeenCalled();
  });
});
