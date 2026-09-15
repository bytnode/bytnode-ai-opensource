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
  test("market spot : quantite arrondie, ordre passe, resultat lisible", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "btcusdt", side: "buy", type: "market", amount: 0.0040000001 }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT", "market", "buy", 0.004, undefined, {});
    expect(r.ok).toBe(true);
    expect(r.output).toBe("Ordre #o1 closed · BUY 0.004 BTC/USDT market · moyen 50000 · rempli 0.004");
  });
  test("quoteAmount : converti au dernier prix", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 200 }, ctx());
    expect(ex.fetchTicker).toHaveBeenCalledWith("BTC/USDT");
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT", "market", "buy", 0.004, undefined, {});
  });
  test("amount et quoteAmount ensemble, ou aucun : refus sans appel", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const both = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 1, quoteAmount: 1 }, ctx());
    const none = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market" }, ctx());
    expect(both.ok).toBe(false);
    expect(none.ok).toBe(false);
    expect(both.output).toBe("Donne `amount` (en BTC) ou `quoteAmount` (en USDT), pas les deux.");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("limit sans prix, stop sans stopPrice : refus", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "limit", amount: 1 }, ctx())).output).toBe("Un ordre `limit` exige `price`.");
    expect((await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", amount: 1 }, ctx())).output).toBe("Un ordre `stop` exige `stopPrice`.");
  });
  test("sous le minimum du marche : refus", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.00001 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Quantité 0.00001 sous le minimum du marché (0.0001 BTC).");
  });
  test("stop_limit et take_profit : parametres ccxt, reduceOnly, levier en futures", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop_limit", amount: 0.01, price: 60000, stopPrice: 60500, reduceOnly: true, leverage: 3, timeInForce: "GTC" }, ctx());
    expect(ex.setLeverage).toHaveBeenCalledWith(3, "BTC/USDT:USDT");
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "limit", "sell", 0.01, 60000, { triggerPrice: 60500, triggerDirection: "ascending", reduceOnly: true, timeInForce: "GTC" });
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "take_profit", amount: 0.01, stopPrice: 70000 }, ctx());
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT:USDT", "market", "sell", 0.01, undefined, { takeProfitPrice: 70000 });
  });
  test("stop : la direction du declencheur vient du dernier prix ; jamais sur Bybit spot", async () => {
    const ex = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(ex);
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([TESTNET]));
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT:USDT", "market", "sell", 0.01, undefined, { triggerPrice: 45000, triggerDirection: "descending" });
    await placeOrderTool.execute({ symbol: "BTC/USDT", side: "sell", type: "stop", amount: 0.01, stopPrice: 45000 }, ctx([TESTNET]));
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT", "market", "sell", 0.01, undefined, { triggerPrice: 45000 });
  });
  test("spot seulement (Coinbase, Kraken) : futures refuses avant tout appel", async () => {
    const ex = fakeExchange({ id: "kraken" });
    mocked.mockResolvedValue(ex);
    const kraken = { ...MAIN, exchange: "kraken", label: "Kraken-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([kraken]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Kraken : spot seulement/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("MEXC : futures en lecture seule, l'ordre est refuse", async () => {
    const ex = fakeExchange({ id: "mexc" });
    mocked.mockResolvedValue(ex);
    const mexc = { ...MAIN, exchange: "mexc", label: "MEXC-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([mexc]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^MEXC : futures en lecture seule/);
    expect(ex.createOrder).not.toHaveBeenCalled();
    const spot = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.01 }, ctx([mexc]));
    expect(spot.ok).toBe(true);
  });
  test("hedge mode Bybit : lu sur les positions (positionIdx)", async () => {
    const ex = fakeExchange({ id: "bybit", has: { fetchPositions: true }, fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", info: { positionIdx: "1" } }]) });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([TESTNET]));
    expect(r.output).toMatch(/hedge mode/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("hedge mode Bitget : lu sur le compte (posMode)", async () => {
    const ex = fakeExchange({ id: "bitget", has: { fetchPositions: true }, privateMixGetV2MixAccountAccount: vi.fn(async () => ({ data: { posMode: "hedge_mode" } })) });
    mocked.mockResolvedValue(ex);
    const bitget = { ...MAIN, exchange: "bitget", label: "Bitget-main" };
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx([bitget]));
    expect(r.output).toMatch(/hedge mode/);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("hedge mode : refus en futures", async () => {
    const ex = fakeExchange({ fetchPositionMode: vi.fn(async () => ({ hedged: true })) });
    mocked.mockResolvedValue(ex);
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "buy", type: "market", amount: 0.01 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("hedge mode");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
  test("fonds insuffisants : erreur en francais", async () => {
    mocked.mockResolvedValue(fakeExchange({ createOrder: vi.fn(async () => { throw ccxtError("InsufficientFunds", "-2019"); }) }));
    const r = await placeOrderTool.execute({ symbol: "BTC/USDT", side: "buy", type: "market", amount: 1 }, ctx());
    expect(r.output).toBe("Fonds insuffisants. Exchange : -2019");
  });
});

describe("CancelOrder", () => {
  test("un ordre par id", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ orderId: "42", symbol: "BTC/USDT" }, ctx());
    expect(ex.cancelOrder).toHaveBeenCalledWith("42", "BTC/USDT");
    expect(r.output).toBe("Ordre #42 annulé.");
  });
  test("tous les ordres d'une paire", async () => {
    const ex = fakeExchange({ cancelAllOrders: vi.fn(async () => [{ id: "1" }, { id: "2" }]) });
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ symbol: "BTC/USDT", all: true }, ctx());
    expect(ex.cancelAllOrders).toHaveBeenCalledWith("BTC/USDT");
    expect(r.output).toBe("2 ordres annulés sur BTC/USDT.");
  });
  test("sans cancelAllOrders (OKX, Coinbase) : les ordres ouverts, un par un", async () => {
    const ex = fakeExchange({ id: "okx", has: { cancelAllOrders: false }, fetchOpenOrders: vi.fn(async () => [{ id: "a" }, { id: "b" }]) });
    mocked.mockResolvedValue(ex);
    const r = await cancelOrderTool.execute({ symbol: "BTC/USDT", all: true }, ctx());
    expect(ex.fetchOpenOrders).toHaveBeenCalledWith("BTC/USDT");
    expect(ex.cancelOrder).toHaveBeenCalledTimes(2);
    expect(ex.cancelOrder).toHaveBeenLastCalledWith("b", "BTC/USDT");
    expect(r.output).toBe("2 ordres annulés sur BTC/USDT.");
  });
  test("ni id ni all : refus", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await cancelOrderTool.execute({ symbol: "BTC/USDT" }, ctx())).output).toBe("Donne `orderId`, ou `symbol` avec `all: true`.");
  });
});

describe("ClosePosition", () => {
  const long = { symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000 };
  test("ferme tout : ordre market inverse, reduceOnly", async () => {
    const ex = fakeExchange({ fetchPositions: vi.fn(async () => [long]), createOrder: vi.fn(async () => ({ id: "c1", status: "closed" })) });
    mocked.mockResolvedValue(ex);
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "market", "sell", 0.05, undefined, { reduceOnly: true });
    expect(r.output).toBe("Position BTC/USDT:USDT LONG fermée à 100 % (0.05) · ordre #c1 closed");
  });
  test("une fraction", async () => {
    const ex = fakeExchange({ fetchPositions: vi.fn(async () => [long]), createOrder: vi.fn(async () => ({ id: "c2", status: "closed" })) });
    mocked.mockResolvedValue(ex);
    const r = await closePositionTool.execute({ symbol: "BTC/USDT", fraction: 0.5 }, ctx());
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "market", "sell", 0.025, undefined, { reduceOnly: true });
    expect(r.output).toBe("Position BTC/USDT:USDT LONG fermée à 50 % (0.025) · ordre #c2 closed");
  });
  test("aucune position", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await closePositionTool.execute({ symbol: "BTC/USDT" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Aucune position ouverte sur BTC/USDT:USDT.");
  });
});

describe("Transfer", () => {
  test("spot → futures : ccxt parle de swap", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "usdt", amount: 100, from: "spot", to: "futures" }, ctx());
    expect(ex.transfer).toHaveBeenCalledWith("USDT", 100, "spot", "swap");
    expect(r.output).toBe("Transfert #t1 : 100 USDT spot → futures.");
  });
  test("meme origine et destination : refus", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "spot" }, ctx())).output).toBe("`from` et `to` doivent différer.");
  });
  test("compte unifie (Bybit) : refus explique, sans appel", async () => {
    const ex = fakeExchange({ id: "bybit" });
    mocked.mockResolvedValue(ex);
    const r = await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "futures" }, ctx([TESTNET]));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Bybit : pas de transfert spot ↔ futures par l'API\. Compte unifié/);
    expect(ex.transfer).not.toHaveBeenCalled();
  });
  test("non pris en charge", async () => {
    mocked.mockResolvedValue(fakeExchange({ transfer: vi.fn(async () => { throw ccxtError("NotSupported", "x"); }) }));
    expect((await transferTool.execute({ asset: "USDT", amount: 1, from: "spot", to: "futures" }, ctx())).output).toBe("Cette opération n'est pas prise en charge par cet exchange. Exchange : x");
  });
});

describe("SetLeverage", () => {
  test("mode de marge puis levier", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 5, marginMode: "isolated" }, ctx());
    expect(ex.setMarginMode).toHaveBeenCalledWith("isolated", "BTC/USDT:USDT");
    expect(ex.setLeverage).toHaveBeenCalledWith(5, "BTC/USDT:USDT");
    expect(r.output).toBe("BTC/USDT:USDT : levier ×5 (isolated).");
  });
  test("mode de marge sans setMarginMode (Gate, HTX) : refus explique", async () => {
    const ex = fakeExchange({ id: "gate", has: { setMarginMode: false } });
    mocked.mockResolvedValue(ex);
    const gate = { ...MAIN, exchange: "gate", label: "Gate-main" };
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 5, marginMode: "isolated" }, ctx([gate]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Gate.io ne permet pas de changer le mode de marge par l'API : réglez-le sur l'exchange, puis relance sans `marginMode`.");
    expect(ex.setLeverage).not.toHaveBeenCalled();
  });
  test("« deja dans ce mode » n'est pas une erreur", async () => {
    const ex = fakeExchange({ setMarginMode: vi.fn(async () => { throw ccxtError("ExchangeError", 'binance {"code":-4046,"msg":"No need to change margin type."}'); }) });
    mocked.mockResolvedValue(ex);
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 2, marginMode: "cross" }, ctx());
    expect(r.ok).toBe(true);
    expect(ex.setLeverage).toHaveBeenCalled();
  });
});
