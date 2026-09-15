import { describe, expect, test } from "vitest";
import { EXCHANGES, ccxtIdFor, exchangeInfo } from "./catalog";

describe("catalogue des exchanges", () => {
  test("dix exchanges, chacun avec ses limites", () => {
    expect(EXCHANGES).toHaveLength(10);
    expect(exchangeInfo("bybit")?.transfer).toBe(false);
    expect(exchangeInfo("okx")?.password).toBe(true);
    expect(exchangeInfo("coinbase")?.futures).toBe("none");
    expect(exchangeInfo("mexc")?.futures).toBe("read");
  });
  test("la classe ccxt suit le marche : KuCoin futures = kucoinfutures", () => {
    expect(ccxtIdFor("kucoin", "spot")).toBe("kucoin");
    expect(ccxtIdFor("kucoin", "futures")).toBe("kucoinfutures");
    expect(ccxtIdFor("binance", "futures")).toBe("binance");
    expect(ccxtIdFor("inconnu", "futures")).toBe("inconnu");
  });
});
