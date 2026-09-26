import type { Exchange } from "ccxt";
import { describe, expect, it, vi } from "vitest";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { PluginStore } from "../core/store";
import { EMPTY_PERMISSIONS, type Permissions } from "./permissions";

/* The trade history a plugin written by an agent may read — never a real
   exchange in a test: `clientFor` hands a fake one. */

const fake: { ex: Partial<Exchange> & Record<string, unknown> } = { ex: {} };
vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: async () => fake.ex }));

const { liveOps, readTrades } = await import("./host-ops");

const now = Date.now();
const trade = (id: string, symbol: string, ago: number, side = "buy") => ({ id, order: `o${id}`, symbol, side, price: 100, amount: 1, cost: 100, fee: { cost: 0.1, currency: "USDT" }, timestamp: now - ago, datetime: new Date(now - ago).toISOString(), takerOrMaker: "taker" });

const account: ExchangeAccount = { id: "acc-1", exchange: "binance", label: "Binance main", apiKey: "k", secret: "s", password: "", testnet: true };

function ops(permissions: Partial<Permissions>, accounts = ["acc-1"]) {
  return liveOps({
    id: "u-journal",
    grant: { permissions: { ...EMPTY_PERMISSIONS, ...permissions }, accounts, digest: "d", at: "" },
    store: {} as PluginStore,
    keys: () => ({ bytnodeKey: "", accounts: [account] }),
    notify: async () => {},
    confirm: async () => ({}) as never,
    hasView: true,
    invoke: async () => null,
  });
}

describe("ctx.exchange.trades", () => {
  it("reads one pair, newest first, with what each trade was", async () => {
    const fetchMyTrades = vi.fn(async () => [trade("1", "BTC/USDT", 3000), trade("2", "BTC/USDT", 1000, "sell")]);
    fake.ex = { id: "kraken", has: { fetchMyTrades: true }, markets: { "BTC/USDT": {} }, fetchMyTrades } as never;
    const r = await readTrades(fake.ex as Exchange, { symbol: "BTC/USDT", limit: 10 });
    expect(r.trades.map((t) => t.id)).toEqual(["2", "1"]);
    expect(r.trades[0]).toMatchObject({ orderId: "o2", symbol: "BTC/USDT", side: "sell", price: 100, amount: 1, cost: 100, fee: { cost: 0.1, currency: "USDT" }, takerOrMaker: "taker" });
    expect(fetchMyTrades).toHaveBeenCalledWith("BTC/USDT", expect.any(Number), 10);
  });

  it("an exchange that wants a pair is read on the pairs held today, and says so", async () => {
    const fetchMyTrades = vi.fn(async (symbol?: string) => {
      if (!symbol) throw Object.assign(new Error("symbol required"), { name: "ArgumentsRequired" });
      return symbol === "ETH/USDT" ? [trade("e1", "ETH/USDT", 500)] : [];
    });
    fake.ex = {
      id: "binance",
      has: { fetchMyTrades: true },
      markets: { "ETH/USDT": {}, "SOL/USDC": {} },
      fetchMyTrades,
      fetchBalance: async () => ({ total: { ETH: 2, SOL: 10, USDT: 500, DOGE: 0 } }),
    } as never;
    const r = await readTrades(fake.ex as Exchange, {});
    expect(r.trades.map((t) => t.id)).toEqual(["e1"]);
    expect(fetchMyTrades.mock.calls.map((c) => c[0])).toEqual([undefined, "ETH/USDT", "SOL/USDC"]);
    expect(r.note).toMatch(/pair by pair.*ETH\/USDT, SOL\/USDC/);
  });

  it("Bybit is read by 7-day windows, as its API answers", async () => {
    const fetchMyTrades = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
    fake.ex = { id: "bybit", has: { fetchMyTrades: true }, markets: {}, fetchMyTrades } as never;
    await readTrades(fake.ex as Exchange, { since: now - 20 * 86_400_000 });
    expect(fetchMyTrades).toHaveBeenCalledTimes(3);
    expect(fetchMyTrades.mock.calls[0][3]).toMatchObject({ type: "spot" });
  });

  it("goes 90 days back at most, and says when the exchange has no history", async () => {
    const fetchMyTrades = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
    fake.ex = { id: "kraken", has: { fetchMyTrades: true }, markets: {}, fetchMyTrades } as never;
    await readTrades(fake.ex as Exchange, { symbol: "BTC/USDT", since: "2020-01-01" });
    expect(fetchMyTrades.mock.calls[0][1] as number).toBeGreaterThan(now - 91 * 86_400_000);
    fake.ex = { id: "x", has: {} } as never;
    await expect(readTrades(fake.ex as Exchange, {})).rejects.toThrow(/does not give the trade history/);
  });

  it("needs the exchange permission and a granted account", async () => {
    fake.ex = { id: "kraken", has: { fetchMyTrades: true }, markets: {}, fetchMyTrades: async () => [trade("1", "BTC/USDT", 100)] } as never;
    await expect(ops({})("exchange.trades", ["acc-1", {}])).rejects.toThrow(/not granted exchange/);
    await expect(ops({ exchange: "read" }, [])("exchange.trades", ["acc-1", {}])).rejects.toThrow(/not one this plugin may use/);
    const r = (await ops({ exchange: "read" })("exchange.trades", ["Binance main", { symbol: "BTC/USDT" }])) as { account: string; testnet: boolean; trades: unknown[] };
    expect(r).toMatchObject({ account: "Binance main", testnet: true });
    expect(r.trades).toHaveLength(1);
  });
});

describe("ctx.exchange.read", () => {
  it("any fetch… method the exchange has, its raw info blocks dropped", async () => {
    const { readMethod } = await import("./host-ops");
    const fetchDeposits = vi.fn(async () => [{ id: "d1", amount: 50, currency: "USDT", info: { secret: "raw" } }]);
    const ex = { id: "kraken", has: { fetchDeposits: true }, fetchDeposits } as unknown as Exchange;
    expect(await readMethod(ex, "fetchDeposits", ["USDT"])).toEqual([{ id: "d1", amount: 50, currency: "USDT" }]);
    expect(fetchDeposits).toHaveBeenCalledWith("USDT");
  });

  it("never a method that acts, the raw fetch, or one the exchange lacks", async () => {
    const { readMethod } = await import("./host-ops");
    const ex = { id: "kraken", has: { createOrder: true, fetchLedger: false }, createOrder: vi.fn(), fetch: vi.fn(), fetchLedger: vi.fn() } as unknown as Exchange;
    await expect(readMethod(ex, "createOrder", [])).rejects.toThrow(/not a reading method/);
    await expect(readMethod(ex, "fetch", ["https://x"])).rejects.toThrow(/not a reading method/);
    await expect(readMethod(ex, "fetchLedger", [])).rejects.toThrow(/has no fetchLedger/);
  });
});
