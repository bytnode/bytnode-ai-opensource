import { describe, expect, test } from "vitest";
import { EXCHANGES, ccxtIdFor, exchangeInfo } from "./catalog";

describe("exchange catalog", () => {
  test("ten exchanges, each with its limits", () => {
    expect(EXCHANGES).toHaveLength(10);
    expect(exchangeInfo("bybit")?.transfer).toBe(false);
    expect(exchangeInfo("okx")?.password).toBe(true);
    expect(exchangeInfo("coinbase")?.futures).toBe("none");
    expect(exchangeInfo("mexc")?.futures).toBe("read");
  });
  test("the ccxt class follows the market: KuCoin futures = kucoinfutures", () => {
    expect(ccxtIdFor("kucoin", "spot")).toBe("kucoin");
    expect(ccxtIdFor("kucoin", "futures")).toBe("kucoinfutures");
    expect(ccxtIdFor("binance", "futures")).toBe("binance");
    expect(ccxtIdFor("unknown", "futures")).toBe("unknown");
  });
});
