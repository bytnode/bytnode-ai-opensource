import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "./client";
import { placeOrderTool } from "./place-order";
import { cancelOrderTool } from "./cancel-order";
import { closePositionTool } from "./close-position";
import { transferTool } from "./transfer";
import { setLeverageTool } from "./set-leverage";
import { ccxtError, ctx, fakeExchange } from "./test-fixture";

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
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT:USDT", "limit", "sell", 0.01, 60000, { triggerPrice: 60500, reduceOnly: true, timeInForce: "GTC" });
    await placeOrderTool.execute({ symbol: "BTC/USDT", market: "futures", side: "sell", type: "take_profit", amount: 0.01, stopPrice: 70000 }, ctx());
    expect(ex.createOrder).toHaveBeenLastCalledWith("BTC/USDT:USDT", "market", "sell", 0.01, undefined, { takeProfitPrice: 70000 });
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
  test("« deja dans ce mode » n'est pas une erreur", async () => {
    const ex = fakeExchange({ setMarginMode: vi.fn(async () => { throw ccxtError("ExchangeError", 'binance {"code":-4046,"msg":"No need to change margin type."}'); }) });
    mocked.mockResolvedValue(ex);
    const r = await setLeverageTool.execute({ symbol: "BTC/USDT", leverage: 2, marginMode: "cross" }, ctx());
    expect(r.ok).toBe(true);
    expect(ex.setLeverage).toHaveBeenCalled();
  });
});
