import { describe, expect, test } from "vitest";
import { toSymbol } from "./symbols";

describe("toSymbol", () => {
  test("spot : la paire, en majuscules", () => {
    expect(toSymbol("btc/usdt", "spot")).toBe("BTC/USDT");
  });
  test("futures : complete en perp lineaire", () => {
    expect(toSymbol("BTC/USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("ETH/USDC", "futures")).toBe("ETH/USDC:USDC");
  });
  test("un symbole deja complet passe tel quel", () => {
    expect(toSymbol("BTC/USDT:USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("BTC/USD:BTC", "futures")).toBe("BTC/USD:BTC");
  });
  test("une paire collee retrouve sa barre sur les quotes connues", () => {
    expect(toSymbol("BTCUSDT", "spot")).toBe("BTC/USDT");
    expect(toSymbol("solusdc", "futures")).toBe("SOL/USDC:USDC");
    expect(toSymbol("ETHBTC", "spot")).toBe("ETH/BTC");
  });
  test("une paire spot demandee avec un suffixe perp perd le suffixe", () => {
    expect(toSymbol("BTC/USDT:USDT", "spot")).toBe("BTC/USDT");
  });
});
