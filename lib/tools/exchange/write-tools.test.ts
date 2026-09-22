import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "./client";
import { placeOrderTool } from "./place-order";
import { cancelOrderTool } from "./cancel-order";
import { closePositionTool } from "./close-position";
import { transferTool } from "./transfer";
import { setLeverageTool } from "./set-leverage";
import { MAIN, TESTNET, ccxtError, ctx, fakeExchange } from "./test-fixture";

vi.mock("./client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);

beforeEach(() => mocked.mockReset());

describe("PlaceOrder", () => {
  test("spot market: rounded quantity, order placed, readable result", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "btcusdt", side: "buy", type: "market", amount: 0.0040000001 }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT", "market", "buy", 0.004, undefined, {});
    expect(r.ok).toBe(true);
    expect(r.output).toBe("Order #o1 closed · BUY 0.004 BTC/USDT market · average 50000 · filled 0.004");
  });
  test("quoteAmount: converted at the last price", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 200 }, ctx());
    expect(ex.fetchTicker).toHaveBeenCalledWith("BTC/USDT");
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT", "market", "buy", 0.004, undefined, {});
  });
  test("amount and quoteAmount together, or neither: refused without a call", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const both = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 1, quoteAmount: 1 }, ctx());
    const none = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market" }, ctx());
    expect(both.ok).toBe(false);
    expect(none.ok).toBe(false);
    expect(both.output).toBe("Give `amount` (in BTC) or `quoteAmount` (in USDT), not both.");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("limit without price, stop without stopPrice: refused", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "limit", amount: 1 }, ctx())).output).toBe("A `limit` order requires `price`.");
    expect((await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", amount: 1 }, ctx())).output).toBe("A `stop` order requires `stopPrice`.");
  });
  test("below the market minimum: refused", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.00001 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Quantity 0.00001 below the market minimum (0.0001 BTC).");
  });
  test("stop_limit and take_profit: ccxt params, reduceOnly, leverage on futures", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop_limit", amount: 0.01, price: 60000, stopPrice: 60500, reduceOnly: true, leverage: 3, timeInForce: "GTC" }, ctx());
    expect(ex.setLeverage).toHaveBeenCalledWith(3, "BTC/USDT:USDT");
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "limit", "sell", 0.01, 60000, { triggerPrice: 60500, triggerDirection: "ascending", reduceOnly: true, timeInForce: "GTC" });
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "take_profit", amount: 0.01, stopPrice: 70000 }, ctx());
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT:USDT", "market", "sell", 0.01, undefined, { takeProfitPrice: 70000 });
  });
  test("stop: the trigger direction comes from the last price; never on Bybit spot", async () => {
    const ex = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([TESTNET]));
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT:USDT", "market", "sell", 0.01, undefined, { triggerPrice: 45000, triggerDirection: "descending" });
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([TESTNET]));
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT", "market", "sell", 0.01, undefined, { triggerPrice: 45000 });
  });
  test("spot only (Coinbase, Kraken): futures refused before any call", async () => {
    const ex = fakeExchange({ id: "kraken" });
    mocked.mockResolvedValue(ex);
    const kraken = { ...MAIN, exchange: "kraken", label: "Kraken-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([kraken]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Kraken: spot only/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("MEXC: futures read-only, the order is refused", async () => {
    const ex = fakeExchange({ id: "mexc" });
    mocked.mockResolvedValue(ex);
    const mexc = { ...MAIN, exchange: "mexc", label: "MEXC-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([mexc]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^MEXC: futures read-only/);
    expect(ex.createOrder).not.toHaveBeenCalled();
    const spot = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.01 }, ctx([mexc]));
    expect(spot.ok).toBe(true);
  });
  test("Bybit hedge mode: read on the positions (positionIdx)", async () => {
    const ex = fakeExchange({ id: "bybit", has: { fetchPositions: true }, fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", info: { positionIdx: "1" } }]) });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([TESTNET]));
    expect(r.output).toMatch(/hedge mode/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("Bitget hedge mode: read on the account (posMode)", async () => {
    const ex = fakeExchange({ id: "bitget", has: { fetchPositions: true }, privateMixGetV2MixAccountAccount: vi.fn(async () => ({ data: { posMode: "hedge_mode" } })) });
    mocked.mockResolvedValue(ex);
    const bitget = { ...MAIN, exchange: "bitget", label: "Bitget-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([bitget]));
    expect(r.output).toMatch(/hedge mode/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("hedge mode: refused on futures", async () => {
    const ex = fakeExchange({ fetchPositionMode: vi.fn(async () => ({ hedged: true })) });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("hedge mode");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("insufficient funds: readable error", async () => {
    mocked.mockResolvedValue(fakeExchange({ createOrder: vi.fn(async () => { throw ccxtError("InsufficientFunds", "-2019"); }) }));
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 1 }, ctx());
    expect(r.output).toBe("Insufficient funds. Exchange: -2019");
  });
});

describe("CancelOrder", () => {
  test("one order by id", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ orderId: "42", symbol: "BTC/USDT" }, ctx());
    expect(ex.cancelOrder).toHaveBeenCalledWith("42", "BTC/USDT");
    expect(r.output).toBe("Order #42 canceled.");
  });
  test("every order on a pair", async () => {
    const ex = fakeExchange({ cancelAllOrders: vi.fn(async () => [{ id: "1" }, { id: "2" }]) });
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ symbol: "BTC/USDT", all: true }, ctx());
    expect(ex.cancelAllOrders).toHaveBeenCalledWith("BTC/USDT");
    expect(r.output).toBe("2 orders canceled on BTC/USDT.");
  });
  test("without cancelAllOrders (OKX, Coinbase): the open orders, one by one", async () => {
    const ex = fakeExchange({ id: "okx", has: { cancelAllOrders: false }, fetchOpenOrders: vi.fn(async () => [{ id: "a" }, { id: "b" }]) });
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ symbol: "BTC/USDT", all: true }, ctx());
    expect(ex.fetchOpenOrders).toHaveBeenCalledWith("BTC/USDT");
    expect(ex.cancelOrder).toHaveBeenCalledTimes(2);
    expect(ex.cancelOrder).toHaveBeenLastCalledWith("b", "BTC/USDT");
    expect(r.output).toBe("2 orders canceled on BTC/USDT.");
  });
  test("neither id nor all: refused", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await cancelOrderTool.execute({ symbol: "BTC/USDT" }, ctx())).output).toBe("Give `orderId`, or `symbol` with `all: true`.");
  });
});

describe("ClosePosition", () => {
  const long = { symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000 };
  test("closes everything: opposite market order, reduceOnly", async () => {
    const ex = fakeExchange({ fetchPositions: vi.fn(async () => [long]), createOrder: vi.fn(async () => ({ id: "c1", status: "closed" })) });
    mocked.mockResolvedValue(ex);
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "market", "sell", 0.05, undefined, { reduceOnly: true });
    expect(r.output).toBe("Position BTC/USDT:USDT LONG closed at 100 % (0.05) · order #c1 closed");
  });
  test("a fraction", async () => {
    const ex = fakeExchange({ fetchPositions: vi.fn(async () => [long]), createOrder: vi.fn(async () => ({ id: "c2", status: "closed" })) });
    mocked.mockResolvedValue(ex);
    const r = await closePositionTool.execute({ symbol: "BTC/USDT", fraction: 0.5 }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "market", "sell", 0.025, undefined, { reduceOnly: true });
    expect(r.output).toBe("Position BTC/USDT:USDT LONG closed at 50 % (0.025) · order #c2 closed");
  });
  test("no position", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("No open position on BTC/USDT:USDT.");
  });
});

describe("Transfer", () => {
  test("spot → futures: ccxt says swap", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "usdt", amount: 100, from: "spot", to: "futures" }, ctx());
    expect(ex.transfer).toHaveBeenCalledWith("USDT", 100, "spot", "swap");
    expect(r.output).toBe("Transfer #t1: 100 USDT spot → futures.");
  });
  test("same origin and destination: refused", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "spot" }, ctx())).output).toBe("`from` and `to` must differ.");
  });
  test("funding → trading on Bybit: the unified account is the destination", async () => {
    const ex = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "USDC", amount: 40, from: "funding", to: "spot" }, ctx([TESTNET]));
    expect(ex.transfer).toHaveBeenCalledWith("USDC", 40, "funding", "unified");
    expect(r.output).toBe("Transfer #t1: 40 USDC funding → spot.");
  });
  test("funding on an exchange that has none (Kraken): refused", async () => {
    const ex = fakeExchange({ id: "kraken" });
    mocked.mockResolvedValue(ex);
    const kraken = { ...MAIN, exchange: "kraken", label: "Kraken-main" };
    const r = await transferTool.execute({ asset: "USDC", amount: 40, from: "funding", to: "spot" }, ctx([kraken]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Kraken has no separate Funding wallet: deposits land directly on the trading account.");
    expect(ex.transfer).not.toHaveBeenCalled();
  });
  test("unified account (Bybit): explained refusal, no call", async () => {
    const ex = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "futures" }, ctx([TESTNET]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Bybit: no spot ↔ futures transfer through the API\. Unified account/);
    expect(ex.transfer).not.toHaveBeenCalled();
  });
  test("not supported", async () => {
    mocked.mockResolvedValue(fakeExchange({ transfer: vi.fn(async () => { throw ccxtError("NotSupported", "x"); }) }));
    expect((await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "futures" }, ctx())).output).toBe("This operation is not supported by this exchange. Exchange: x");
  });
});

describe("SetLeverage", () => {
  test("margin mode then leverage", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 5, marginMode: "isolated" }, ctx());
    expect(ex.setMarginMode).toHaveBeenCalledWith("isolated", "BTC/USDT:USDT");
    expect(ex.setLeverage).toHaveBeenCalledWith(5, "BTC/USDT:USDT");
    expect(r.output).toBe("BTC/USDT:USDT: leverage ×5 (isolated).");
  });
  test("margin mode without setMarginMode (Gate, HTX): explained refusal", async () => {
    const ex = fakeExchange({ id: "gate", has: { setMarginMode: false } });
    mocked.mockResolvedValue(ex);
    const gate = { ...MAIN, exchange: "gate", label: "Gate-main" };
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 5, marginMode: "isolated" }, ctx([gate]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Gate.io does not allow changing the margin mode through the API: set it on the exchange, then run again without `marginMode`.");
    expect(ex.setLeverage).not.toHaveBeenCalled();
  });
  test("\"already in this mode\" is not an error", async () => {
    const ex = fakeExchange({ setMarginMode: vi.fn(async () => { throw ccxtError("ExchangeError", 'binance {"code":-4046,"msg":"No need to change margin type."}'); }) });
    mocked.mockResolvedValue(ex);
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 2, marginMode: "cross" }, ctx());
    expect(r.ok).toBe(true);
    expect(ex.setLeverage).toHaveBeenCalled();
  });
});
