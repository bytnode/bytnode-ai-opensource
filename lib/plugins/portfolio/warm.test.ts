import { describe, expect, test } from "vitest";
import type { ExchangeAccount } from "@/lib/domain/types";
import { accountsKey, holdingsKey, holdingsOf, Warm } from "./warm";

const acc = (id: string, apiKey = "k"): ExchangeAccount => ({ id, exchange: "bybit", label: id, apiKey, secret: "s", password: "", testnet: false });

describe("Warm", () => {
  test("one load shared while fresh, a new one after", async () => {
    const w = new Warm<number>(1000);
    let loads = 0;
    const load = async () => ++loads;
    await Promise.all([w.get("a", load, 0), w.get("a", load, 10)]);
    expect(loads).toBe(1);
    expect(await w.get("a", load, 500)).toBe(1);
    expect(await w.get("a", load, 1500)).toBe(2);
    expect(w.has("a", 1600)).toBe(true);
    expect(w.has("a", 3000)).toBe(false);
  });
  test("a failure is forgotten: the next call loads again", async () => {
    const w = new Warm<number>(60_000);
    await expect(w.get("a", () => Promise.reject(new Error("down")), 0)).rejects.toThrow("down");
    await Promise.resolve();
    expect(await w.get("a", async () => 7, 1)).toBe(7);
  });
  test("keeps at most `max` keys", async () => {
    const w = new Warm<number>(60_000, 2);
    for (const k of ["a", "b", "c"]) await w.get(k, async () => 1, 0);
    expect(w.has("a", 1)).toBe(false);
    expect(w.has("c", 1)).toBe(true);
  });
});

describe("keys", () => {
  test("the accounts' key: order-free, changes with an account or its keys", () => {
    const k = accountsKey([acc("a"), acc("b")], "bn");
    expect(accountsKey([acc("b"), acc("a")], "bn")).toBe(k);
    expect(accountsKey([acc("a")], "bn")).not.toBe(k);
    expect(accountsKey([acc("a", "other"), acc("b")], "bn")).not.toBe(k);
    expect(accountsKey([acc("a"), acc("b")], "")).not.toBe(k);
    expect(k).not.toContain("k");
  });
  test("the history's key: the assets held, not their amounts", () => {
    const h1 = [{ id: "a", assets: [{ asset: "BTC", amount: 1 }, { asset: "ETH", amount: 2 }] }];
    const h2 = [{ id: "a", assets: [{ asset: "ETH", amount: 2.0001 }, { asset: "BTC", amount: 0.99 }] }];
    expect(holdingsKey(h1)).toBe(holdingsKey(h2));
    expect(holdingsKey([{ id: "a", assets: [{ asset: "BTC", amount: 1 }] }])).not.toBe(holdingsKey(h1));
  });
  test("the holdings: live accounts only, 6 significant digits — as the view sends them", () => {
    const summary = {
      accounts: [
        { id: "a", label: "A", exchange: "bybit", testnet: false, usd: 0, unpriced: 0, wallets: {} as never, assets: [{ asset: "BTC", amount: 0.123456789, usd: 0, share: 0 }] },
        { id: "t", label: "T", exchange: "bybit", testnet: true, usd: 0, unpriced: 0, wallets: {} as never, assets: [] },
        { label: "no id", exchange: "x", testnet: false, usd: 0, unpriced: 0, wallets: {} as never, assets: [] },
      ],
    };
    expect(holdingsOf(summary)).toEqual([{ id: "a", assets: [{ asset: "BTC", amount: 0.123457 }] }]);
  });
});
