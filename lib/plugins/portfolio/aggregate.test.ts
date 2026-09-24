import { describe, expect, it } from "vitest";
import { assetsToPrice, change, history, snapshotOf, summarize, type AccountRead, type Snapshot } from "./aggregate";

const main: AccountRead = {
  label: "Binance-main",
  exchange: "binance",
  testnet: false,
  wallets: [
    { wallet: "spot", rows: [{ asset: "BTC", amount: 0.1 }, { asset: "USDT", amount: 1000 }, { asset: "XYZ", amount: 5000 }] },
    { wallet: "funding", rows: [{ asset: "USDC", amount: 40 }] },
    { wallet: "futures", rows: [{ asset: "USDT", amount: 500 }] },
  ],
  positions: [{ symbol: "BTC/USDT:USDT", side: "long", size: 0.01, entry: 60000, mark: 64000, pnl: 40, leverage: 5, liquidation: 49000 }],
};
const other: AccountRead = { label: "Bybit", exchange: "bybit", testnet: false, wallets: [{ wallet: "spot", rows: [{ asset: "ETH", amount: 1 }] }], positions: [], error: "Funding wallet: key lacks the transfer permission." };
const test: AccountRead = { label: "Test", exchange: "bybit", testnet: true, wallets: [{ wallet: "spot", rows: [{ asset: "USDT", amount: 10000 }] }], positions: [{ symbol: "ETH/USDT:USDT", side: "short", size: 1, entry: 3000, mark: 3100, pnl: -100, leverage: 2, liquidation: null }] };
const prices = { BTC: 64000, ETH: 3000 };

describe("summarize", () => {
  const s = summarize([main, other, test], prices);

  it("adds the live accounts, every wallet, stablecoins at one dollar", () => {
    /* 6 400 + 1 000 + 40 + 500 + 3 000 */
    expect(s.totalUsd).toBe(10940);
  });

  it("keeps testnet apart, and out of the total", () => {
    expect(s.testnetUsd).toBe(10000);
    expect(s.accounts.find((a) => a.label === "Test")).toMatchObject({ testnet: true, usd: 10000 });
    expect(s.unrealizedPnl).toBe(40);
    expect(s.positions).toHaveLength(2);
  });

  it("never values an unpriced asset at zero in silence", () => {
    expect(s.unpriced).toEqual([{ label: "Binance-main", asset: "XYZ", amount: 5000 }]);
    expect(s.accounts[0].unpriced).toBe(1);
  });

  it("splits by asset, largest first, with shares", () => {
    expect(s.assets.map((a) => a.asset)).toEqual(["BTC", "ETH", "USDT", "USDC"]);
    expect(s.assets[0].share).toBeCloseTo(6400 / 10940, 10);
    expect(s.assets.find((a) => a.asset === "USDT")?.amount).toBe(1500);
  });

  it("splits the live value by wallet, and each account on its own", () => {
    expect(s.wallets).toEqual({ spot: 6400 + 1000 + 3000, funding: 40, futures: 500 });
    const m = s.accounts[0];
    expect(m.wallets).toEqual({ spot: 7400, funding: 40, futures: 500 });
    expect(m.assets.map((a) => a.asset)).toEqual(["BTC", "USDT", "USDC"]);
    expect(m.assets[1]).toMatchObject({ amount: 1500, usd: 1500 });
    expect(m.assets[0].share).toBeCloseTo(6400 / 7940, 10);
    expect(s.accounts[2].wallets.spot).toBe(10000);
  });

  it("files each live account's total under its id in the snapshot — never a name", () => {
    const withIds = summarize([{ ...main, id: "u-1" }, { ...other, id: "u-2" }, { ...test, id: "u-3" }], prices);
    const snap = snapshotOf(withIds, new Date("2026-09-24T23:55:00Z"));
    /* Bybit could not be read in full: not filed; the testnet: never. */
    expect(snap.accounts).toEqual({ "u-1": 7940 });
    expect(JSON.stringify(snap)).not.toMatch(/Binance-main|Bybit|Test/);
  });

  it("reports an account's error without dropping it", () => {
    expect(s.accounts[1]).toMatchObject({ label: "Bybit", usd: 3000, error: "Funding wallet: key lacks the transfer permission." });
  });

  it("knows what to price", () => {
    expect(assetsToPrice([main, other, test]).sort()).toEqual(["BTC", "ETH", "XYZ"]);
  });
});

describe("snapshots", () => {
  const snap = (date: string, totalUsd: number): Snapshot => ({ date, at: `${date}T23:55:00.000Z`, totalUsd, assets: {} });

  it("one per day, the last of the day, within the window", () => {
    const lines = [snap("2026-09-01", 100), snap("2026-09-20", 900), snap("2026-09-21", 1000), snap("2026-09-21", 1100), snap("2026-09-23", 1210)];
    const h = history(lines, 7, new Date("2026-09-23T12:00:00Z"));
    expect(h.map((x) => [x.date, x.totalUsd])).toEqual([
      ["2026-09-20", 900],
      ["2026-09-21", 1100],
      ["2026-09-23", 1210],
    ]);
    expect(change(h)).toEqual({ usd: 310, pct: (310 / 900) * 100 });
    expect(change(h.slice(0, 1))).toBeNull();
  });

  it("a snapshot names assets, never accounts", () => {
    const s = snapshotOf(summarize([main], prices), new Date("2026-09-23T23:55:00Z"));
    expect(s).toEqual({ date: "2026-09-23", at: "2026-09-23T23:55:00.000Z", totalUsd: 7940, assets: { BTC: 6400, USDT: 1500, USDC: 40 } });
    expect(JSON.stringify(s)).not.toContain("Binance");
  });
});
