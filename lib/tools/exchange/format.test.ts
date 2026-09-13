import { describe, expect, test } from "vitest";
import type { FundingRate, Order, OrderBook, Position, Ticker } from "ccxt";
import { formatBalance, formatOrders, formatPositions, formatTicker, n8 } from "./format";

test("n8 : jusqu'a 8 chiffres significatifs, sans zeros inutiles", () => {
  expect(n8(0.05)).toBe("0.05");
  expect(n8(67432.15)).toBe("67432.15");
  expect(n8(0.000012345678)).toBe("0.000012345678");
  expect(n8(1.123456789)).toBe("1.1234568");
  expect(n8(undefined)).toBe("–");
});

describe("formatBalance", () => {
  test("une ligne par actif, total en USD quand on le connait", () => {
    const rows = [
      { asset: "USDT", free: 1500, used: 500, total: 2000, usd: 2000 },
      { asset: "BTC", free: 0.05, used: 0, total: 0.05, usd: 3371.6 },
      { asset: "DOGE", free: 10, used: 0, total: 10 },
    ];
    expect(formatBalance("Binance-main", "spot", rows)).toBe(
      [
        "Binance-main · spot",
        "USDT : 2000 (libre 1500, bloqué 500) ≈ 2000 USD",
        "BTC : 0.05 (libre 0.05) ≈ 3371.6 USD",
        "DOGE : 10 (libre 10)",
        "Total ≈ 5371.6 USD (hors actifs sans prix)",
      ].join("\n"),
    );
  });
  test("compte vide", () => {
    expect(formatBalance("Bybit-test", "futures", [])).toBe("Bybit-test · futures\nAucun solde.");
  });
});

describe("formatPositions", () => {
  test("cote, taille, entree, mark, PnL, levier, liquidation", () => {
    const p = [
      { symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, leverage: 5, liquidationPrice: 52000, marginMode: "isolated" },
    ] as unknown as Position[];
    expect(formatPositions(p)).toBe("BTC/USDT:USDT · LONG 0.05 · entrée 65000 · mark 67000 · PnL +100 (+3.08 %) · ×5 isolated · liquidation 52000 (−22.39 %)");
  });
  test("aucune position", () => {
    expect(formatPositions([])).toBe("Aucune position ouverte.");
    expect(formatPositions([{ symbol: "X", contracts: 0 }] as unknown as Position[])).toBe("Aucune position ouverte.");
  });
});

describe("formatOrders", () => {
  test("une ligne par ordre", () => {
    const o = [
      { id: "123", symbol: "BTC/USDT", type: "limit", side: "buy", price: 60000, amount: 0.1, filled: 0.04, status: "open", timestamp: 1700000000000, fee: { cost: 0.12, currency: "USDT" } },
    ] as unknown as Order[];
    expect(formatOrders(o)).toBe("2023-11-14T22:13:20Z · #123 · BTC/USDT · BUY limit 0.1 @ 60000 · rempli 0.04 · open · frais 0.12 USDT");
  });
  test("aucun ordre", () => {
    expect(formatOrders([])).toBe("Aucun ordre.");
  });
});

describe("formatTicker", () => {
  test("prix, carnet, funding", () => {
    const t = { symbol: "BTC/USDT:USDT", last: 67000, bid: 66999, ask: 67001, baseVolume: 12345.6, percentage: 1.2 } as unknown as Ticker;
    const book = { bids: [[66999, 1.5], [66998, 2]], asks: [[67001, 0.8]] } as unknown as OrderBook;
    const f = { fundingRate: 0.0001, fundingTimestamp: 1700000000000 } as unknown as FundingRate;
    expect(formatTicker(t, book, f)).toBe(
      [
        "BTC/USDT:USDT · last 67000 · bid 66999 / ask 67001 · 24 h +1.2 % · volume 12345.6",
        "Funding 0.01 % · prochain 2023-11-14T22:13:20Z",
        "Carnet :",
        "  ask 67001 × 0.8",
        "  bid 66999 × 1.5",
        "  bid 66998 × 2",
      ].join("\n"),
    );
  });
  test("sans carnet ni funding", () => {
    expect(formatTicker({ symbol: "ETH/USDT", last: 3000 } as unknown as Ticker)).toBe("ETH/USDT · last 3000 · bid – / ask – · 24 h – · volume –");
  });
});
