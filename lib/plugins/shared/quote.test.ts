import { describe, expect, it } from "vitest";
import { baseOf, bytnodeSymbol, readFunding, readPriceChange } from "./quote";
import { CURRENCIES, fromUsd, fxPair, isCurrency, unitsPerUsd } from "./fx";

const now = new Date("2026-09-23T12:00:00Z");

describe("readPriceChange", () => {
  it("finds the block in BytNode's envelope", () => {
    const response = {
      status: "ok",
      timestamp: "2026-09-23T11:59:58Z",
      data_type: "snapshot",
      data: { price_change: { price: 64210.5, timestamp: "2026-09-23T11:59:58Z", changes: { "1m": 0.01, "1h": -0.3, "4h": 1.2, "1d": 2.4, "1w": -5.1 } } },
    };
    expect(readPriceChange(response, "BTC/USDT", now)).toEqual({
      symbol: "BTC/USDT",
      price: 64210.5,
      change1h: -0.3,
      change4h: 1.2,
      change24h: 2.4,
      change7d: -5.1,
      source: "bytnode",
      at: "2026-09-23T11:59:58Z",
    });
  });

  it("accepts epoch timestamps and missing changes", () => {
    const q = readPriceChange({ price_change: { price: "3100", timestamp: 1790000000000, changes: { "1d": null } } }, "ETH/USDT", now);
    expect(q?.price).toBe(3100);
    expect(q?.change24h).toBeUndefined();
    expect(q?.at).toBe(new Date(1790000000000).toISOString());
  });

  it("says nothing when there is no price", () => {
    expect(readPriceChange({ error: "Erreur (HTTP 400)" }, "X/USDT", now)).toBeNull();
    expect(readPriceChange("text", "X/USDT", now)).toBeNull();
  });

  it("reads the funding rate in %", () => {
    expect(readFunding({ data: { funding_next: { estimated_rate: 0.0001, apr: 10.95 } } })).toBeCloseTo(0.01, 10);
    expect(readFunding({})).toBeUndefined();
  });

  it("converts symbol forms", () => {
    expect(bytnodeSymbol("BTC/USDT")).toBe("BTCUSDT");
    expect(bytnodeSymbol("btc/usdt:USDT")).toBe("BTCUSDT");
    expect(baseOf("eth/usdt")).toBe("ETH");
  });
});

describe("fx", () => {
  it("offers six currencies, USD first", () => {
    expect(CURRENCIES).toEqual(["USD", "EUR", "GBP", "JPY", "AUD", "CHF"]);
    expect(isCurrency("CHF")).toBe(true);
    expect(isCurrency("CNY")).toBe(false);
  });

  it("reads each currency from the right pair, the right way round", () => {
    expect(fxPair("EUR")).toEqual({ pair: "EUR/USD", invert: true });
    expect(fxPair("JPY")).toEqual({ pair: "USD/JPY", invert: false });
    expect(fxPair("CHF")).toEqual({ pair: "USD/CHF", invert: false });
    expect(unitsPerUsd("EUR", 1.25)).toBe(0.8);
    expect(unitsPerUsd("CHF", 0.82)).toBe(0.82);
    expect(fromUsd(1000, 0.8)).toBe(800);
  });
});
