import { describe, expect, test } from "vitest";
import type { FundingRate, Order, OrderBook, Position, Ticker } from "ccxt";
import { formatBalance, formatOrders, formatPositions, formatTicker, n8 } from "./format";

test("n8: up to 8 significant digits, without needless zeros", () => {
  expect(n8(0.05)).toBe("0.05");
  expect(n8(67432.15)).toBe("67432.15");
  expect(n8(0.000012345678)).toBe("0.000012345678");
  expect(n8(1.123456789)).toBe("1.1234568");
  expect(n8(undefined)).toBe("–");
});

describe("formatBalance", () => {
  test("one line per asset, USD total when known", () => {
    const rows = [
      { asset: "USDT", free: 1500, used: 500, total: 2000, usd: 2000 },
      { asset: "BTC", free: 0.05, used: 0, total: 0.05, usd: 3371.6 },
      { asset: "DOGE", free: 10, used: 0, total: 10 },
    ];
    expect(formatBalance("Binance-main", "spot", rows)).toBe(
      [
        "Binance-main · spot",
        "USDT: 2000 (free 1500, locked 500) ≈ 2000 USD",
        "BTC: 0.05 (free 0.05) ≈ 3371.6 USD",
        "DOGE: 10 (free 10)",
        "Total ≈ 5371.6 USD (excluding unpriced assets)",
      ].join("\n"),
    );
  });
  test("empty account", () => {
    expect(formatBalance("Bybit-test", "futures", [])).toBe("Bybit-test · futures\nNo balance.");
  });
});

describe("formatPositions", () => {
  test("side, size, entry, mark, PnL, leverage, liquidation", () => {
    const p = [
      { symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, leverage: 5, liquidationPrice: 52000, marginMode: "isolated" },
    ] as unknown as Position[];
    expect(formatPositions(p)).toBe("BTC/USDT:USDT · LONG 0.05 · entry 65000 · mark 67000 · PnL +100 (+3.08 %) · ×5 isolated · liquidation 52000 (−22.39 %)");
  });
  test("no position", () => {
    expect(formatPositions([])).toBe("No open position.");
    expect(formatPositions([{ symbol: "X", contracts: 0 }] as unknown as Position[])).toBe("No open position.");
  });
});

describe("formatOrders", () => {
  test("one line per order", () => {
    const o = [
      { id: "123", symbol: "BTC/USDT", type: "limit", side: "buy", price: 60000, amount: 0.1, filled: 0.04, status: "open", timestamp: 1700000000000, fee: { cost: 0.12, currency: "USDT" } },
    ] as unknown as Order[];
    expect(formatOrders(o)).toBe("2023-11-14T22:13:20Z · #123 · BTC/USDT · BUY limit 0.1 @ 60000 · filled 0.04 · open · fee 0.12 USDT");
  });
  test("no order", () => {
    expect(formatOrders([])).toBe("No order.");
  });
});

describe("formatTicker", () => {
  test("price, order book, funding", () => {
    const t = { symbol: "BTC/USDT:USDT", last: 67000, bid: 66999, ask: 67001, baseVolume: 12345.6, percentage: 1.2 } as unknown as Ticker;
    const book = { bids: [[66999, 1.5], [66998, 2]], asks: [[67001, 0.8]] } as unknown as OrderBook;
    const f = { fundingRate: 0.0001, fundingTimestamp: 1700000000000 } as unknown as FundingRate;
    expect(formatTicker(t, book, f)).toBe(
      [
        "BTC/USDT:USDT · last 67000 · bid 66999 / ask 67001 · 24 h +1.2 % · volume 12345.6",
        "Funding 0.01 % · next 2023-11-14T22:13:20Z",
        "Order book:",
        "  ask 67001 × 0.8",
        "  bid 66999 × 1.5",
        "  bid 66998 × 2",
      ].join("\n"),
    );
  });
  test("without order book or funding", () => {
    expect(formatTicker({ symbol: "ETH/USDT", last: 3000 } as unknown as Ticker)).toBe("ETH/USDT · last 3000 · bid – / ask – · 24 h – · volume –");
  });
});
