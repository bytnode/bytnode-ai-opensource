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
  test("soldes avec estimation USD : stable a 1, cote via fetchTickers, sans marche sans prix", async () => {
    const ex = fakeExchange({
      fetchBalance: vi.fn(async () => ({ total: { USDT: 2000, BTC: 0.05, DOGE: 10, ZERO: 0 }, free: { USDT: 1500, BTC: 0.05, DOGE: 10 }, used: { USDT: 500, BTC: 0, DOGE: 0 } })),
      fetchTickers: vi.fn(async () => ({ "BTC/USDT": { last: 67432 } })),
    });
    mocked.mockResolvedValue(ex);
    const r = await balanceTool.execute({}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe(
      ["Binance-main · spot", "USDT : 2000 (libre 1500, bloqué 500) ≈ 2000 USD", "BTC : 0.05 (libre 0.05) ≈ 3371.6 USD", "DOGE : 10 (libre 10)", "Total ≈ 5371.6 USD (hors actifs sans prix)"].join("\n"),
    );
    expect(ex.fetchTickers).toHaveBeenCalledWith(["BTC/USDT"]);
  });
  test("cle refusee : erreur en francais", async () => {
    mocked.mockResolvedValue(fakeExchange({ fetchBalance: vi.fn(async () => { throw ccxtError("AuthenticationError", "bad key"); }) }));
    const r = await balanceTool.execute({}, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Clé API refusée : vérifiez le compte dans Authentification (bouton Tester). Exchange : bad key");
  });
  test("deux comptes sans `account` : erreur, sans appel", async () => {
    const r = await balanceTool.execute({}, ctx([MAIN, TESTNET]));
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Plusieurs comptes : précise `account` parmi Binance-main, Bybit-test.");
    expect(mocked).not.toHaveBeenCalled();
  });
  test("le marche futures ouvre un client futures", async () => {
    mocked.mockResolvedValue(fakeExchange());
    await balanceTool.execute({ market: "futures" }, ctx());
    expect(mocked).toHaveBeenCalledWith(MAIN, "futures");
  });
});

describe("ExchangePositions", () => {
  test("toujours en futures, filtre par symbole normalise", async () => {
    const ex = fakeExchange({
      fetchPositions: vi.fn(async () => [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, leverage: 5, liquidationPrice: 52000, marginMode: "isolated" }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await positionsTool.execute({ symbol: "btc/usdt" }, ctx());
    expect(mocked).toHaveBeenCalledWith(MAIN, "futures");
    expect(ex.fetchPositions).toHaveBeenCalledWith(["BTC/USDT:USDT"]);
    expect(r.output).toBe("BTC/USDT:USDT · LONG 0.05 · entrée 65000 · mark 67000 · PnL +100 (+3.08 %) · ×5 isolated · liquidation 52000 (−22.39 %)");
  });
  test("aucune position", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await positionsTool.execute({}, ctx())).output).toBe("Aucune position ouverte.");
  });
  test("marche inconnu", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await positionsTool.execute({ symbol: "XYZ/USDT" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Marché inconnu sur binance : XYZ/USDT:USDT.");
  });
});

describe("ExchangeOrders", () => {
  test("ordres ouverts", async () => {
    const ex = fakeExchange({
      fetchOpenOrders: vi.fn(async () => [{ id: "123", symbol: "BTC/USDT", type: "limit", side: "buy", price: 60000, amount: 0.1, filled: 0.04, status: "open", timestamp: 1700000000000, fee: { cost: 0.12, currency: "USDT" } }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await ordersTool.execute({ status: "open", symbol: "BTC/USDT", since: "2023-11-01T00:00:00Z", limit: 10 }, ctx());
    expect(ex.fetchOpenOrders).toHaveBeenCalledWith("BTC/USDT", Date.parse("2023-11-01T00:00:00Z"), 10);
    expect(r.output).toBe("2023-11-14T22:13:20Z · #123 · BTC/USDT · BUY limit 0.1 @ 60000 · rempli 0.04 · open · frais 0.12 USDT");
  });
  test("ordres clos : repli sur fetchOrders quand l'exchange n'a pas fetchClosedOrders", async () => {
    const ex = fakeExchange({
      has: { fetchClosedOrders: false },
      fetchOrders: vi.fn(async () => [{ id: "1", symbol: "BTC/USDT", type: "market", side: "sell", amount: 1, status: "closed", timestamp: 1700000000000 }, { id: "2", symbol: "BTC/USDT", type: "limit", side: "buy", amount: 1, status: "open" }]),
    });
    mocked.mockResolvedValue(ex);
    const r = await ordersTool.execute({ status: "closed" }, ctx());
    expect(r.output).toBe("2023-11-14T22:13:20Z · #1 · BTC/USDT · SELL market 1 · closed");
  });
  test("aucun ordre", async () => {
    mocked.mockResolvedValue(fakeExchange());
    expect((await ordersTool.execute({ status: "open" }, ctx())).output).toBe("Aucun ordre.");
  });
});

describe("ExchangeTicker", () => {
  test("futures : ticker, carnet, funding", async () => {
    const ex = fakeExchange({
      fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT:USDT", last: 67000, bid: 66999, ask: 67001, baseVolume: 12345.6, percentage: 1.2 })),
      fetchOrderBook: vi.fn(async () => ({ bids: [[66999, 1.5]], asks: [[67001, 0.8]] })),
      fetchFundingRate: vi.fn(async () => ({ fundingRate: 0.0001, fundingTimestamp: 1700000000000 })),
    });
    mocked.mockResolvedValue(ex);
    const r = await tickerTool.execute({ symbol: "BTC/USDT", market: "futures", depth: 1 }, ctx());
    expect(ex.fetchOrderBook).toHaveBeenCalledWith("BTC/USDT:USDT", 1);
    expect(r.output).toBe(["BTC/USDT:USDT · last 67000 · bid 66999 / ask 67001 · 24 h +1.2 % · volume 12345.6", "Funding 0.01 % · prochain 2023-11-14T22:13:20Z", "Carnet :", "  ask 67001 × 0.8", "  bid 66999 × 1.5"].join("\n"));
  });
  test("spot sans carnet : une ligne ; un carnet qui echoue n'empeche rien", async () => {
    const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: 50000 })), fetchOrderBook: vi.fn(async () => { throw ccxtError("NetworkError"); }) });
    mocked.mockResolvedValue(ex);
    expect((await tickerTool.execute({ symbol: "BTC/USDT", depth: 0 }, ctx())).output).toBe("BTC/USDT · last 50000 · bid – / ask – · 24 h – · volume –");
    expect(ex.fetchOrderBook).not.toHaveBeenCalled();
    expect((await tickerTool.execute({ symbol: "BTC/USDT" }, ctx())).output).toBe("BTC/USDT · last 50000 · bid – / ask – · 24 h – · volume –");
    expect(ex.fetchFundingRate).not.toHaveBeenCalled();
  });
});
