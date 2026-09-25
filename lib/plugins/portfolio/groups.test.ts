import { describe, expect, it } from "vitest";
import { summarize, type AccountRead, type Snapshot } from "./aggregate";
import { MAX_GROUPS, addGroup, editGroup, groupPoints, groupSummary, removeGroup, type AccountGroup } from "./groups";

const now = new Date("2026-09-25T12:00:00Z");

describe("account groups", () => {
  it("are made with a name and at least one account", () => {
    const made = addGroup([], "  Long   term ", ["a", "b", "a", 3], "g1", now);
    expect(made).toEqual({ groups: [{ id: "g1", name: "Long term", accountIds: ["a", "b"], createdAt: now.toISOString() }], group: expect.objectContaining({ id: "g1" }) });
    expect(addGroup([], "", ["a"], "g", now)).toEqual({ error: "Give the group a name." });
    expect(addGroup([], "X", [], "g", now)).toEqual({ error: "Choose at least one account for the group." });
  });

  it("refuse a name already taken, whatever its case, and too many groups", () => {
    const one: AccountGroup[] = [{ id: "g1", name: "Long term", accountIds: ["a"], createdAt: "" }];
    expect(addGroup(one, "long TERM", ["b"], "g2", now)).toEqual({ error: 'A group is already named "long TERM".' });
    const full = Array.from({ length: MAX_GROUPS }, (_, i) => ({ id: `g${i}`, name: `G${i}`, accountIds: ["a"], createdAt: "" }));
    expect(addGroup(full, "One more", ["a"], "x", now)).toEqual({ error: `At most ${MAX_GROUPS} groups.` });
  });

  it("are renamed, given other accounts, deleted", () => {
    const one: AccountGroup[] = [{ id: "g1", name: "Long term", accountIds: ["a"], createdAt: "" }];
    const edited = editGroup(one, "g1", { name: "Core", accountIds: ["b", "c"] });
    expect("group" in edited && edited.group).toMatchObject({ name: "Core", accountIds: ["b", "c"] });
    expect(editGroup(one, "g1", { accountIds: [] })).toEqual({ error: "Choose at least one account for the group." });
    expect(editGroup(one, "nope", { name: "X" })).toEqual({ error: "No such group." });
    expect(removeGroup(one, "g1")).toEqual({ groups: [] });
    expect(removeGroup(one, "nope")).toEqual({ error: "No such group." });
  });
});

describe("a group's report", () => {
  const reads: AccountRead[] = [
    { id: "a", label: "Binance", exchange: "binance", testnet: false, wallets: [{ wallet: "spot", rows: [{ asset: "BTC", amount: 1 }, { asset: "USDT", amount: 500 }] }], positions: [{ symbol: "ETH/USDT:USDT", side: "long", size: 1, entry: 1, mark: 1, pnl: 40, leverage: 2, liquidation: null }] },
    { id: "b", label: "Kraken", exchange: "kraken", testnet: false, wallets: [{ wallet: "funding", rows: [{ asset: "BTC", amount: 0.5 }, { asset: "XYZ", amount: 3 }] }], positions: [] },
    { id: "c", label: "Bybit", exchange: "bybit", testnet: false, wallets: [{ wallet: "spot", rows: [{ asset: "ETH", amount: 2 }] }], positions: [{ symbol: "BTC/USDT:USDT", side: "short", size: 1, entry: 1, mark: 1, pnl: -10, leverage: 2, liquidation: null }] },
    { id: "t", label: "Test", exchange: "bybit", testnet: true, wallets: [{ wallet: "spot", rows: [{ asset: "USDT", amount: 1000 }] }], positions: [] },
  ];
  const whole = summarize(reads, { BTC: 60_000, ETH: 3_000 });

  it("is the whole cut to its accounts", () => {
    const g = groupSummary(whole, ["a", "b", "t"]);
    expect(g.totalUsd).toBe(60_000 + 500 + 30_000);
    expect(g.testnetUsd).toBe(1000);
    expect(g.accounts.map((a) => a.label)).toEqual(["Binance", "Kraken", "Test"]);
    expect(g.assets.map((a) => [a.asset, a.amount])).toEqual([["BTC", 1.5], ["USDT", 500]]);
    expect(g.assets[0].share).toBeCloseTo(90_000 / 90_500);
    expect(g.wallets).toEqual({ spot: 60_500, funding: 30_000, futures: 0, earn: 0 });
    expect(g.positions.map((p) => p.symbol)).toEqual(["ETH/USDT:USDT"]);
    expect(g.unrealizedPnl).toBe(40);
    expect(g.unpriced).toEqual([{ label: "Kraken", asset: "XYZ", amount: 3 }]);
  });

  it("an account gone from the settings drops out", () => {
    expect(groupSummary(whole, ["gone"]).totalUsd).toBe(0);
  });

  it("its curve sums its accounts' daily totals and flows", () => {
    const points: Snapshot[] = [
      { date: "2026-09-20", at: "", totalUsd: 10, assets: {}, accounts: { c: 10 } },
      { date: "2026-09-21", at: "", totalUsd: 30, assets: {}, accounts: { a: 20, c: 10 }, flowUsd: 5, flows: { a: 5 } },
      { date: "2026-09-22", at: "", totalUsd: 60, assets: {}, accounts: { a: 22, b: 30, c: 8 } },
    ];
    expect(groupPoints(points, ["a", "b"])).toEqual([
      { date: "2026-09-21", at: "", totalUsd: 20, assets: {}, accounts: { a: 20 }, flowUsd: 5, flows: { a: 5 } },
      { date: "2026-09-22", at: "", totalUsd: 52, assets: {}, accounts: { a: 22, b: 30 } },
    ]);
  });
});
