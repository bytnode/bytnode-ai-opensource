import { describe, expect, test } from "vitest";
import { toSymbol } from "./symbols";

describe("toSymbol", () => {
  test("spot: the pair, in uppercase", () => {
    expect(toSymbol("btc/usdt", "spot")).toBe("BTC/USDT");
  });
  test("futures: completed into a linear perp", () => {
    expect(toSymbol("BTC/USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("ETH/USDC", "futures")).toBe("ETH/USDC:USDC");
  });
  test("an already complete symbol passes as is", () => {
    expect(toSymbol("BTC/USDT:USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("BTC/USD:BTC", "futures")).toBe("BTC/USD:BTC");
  });
  test("a glued pair gets its slash back on the known quotes", () => {
    expect(toSymbol("BTCUSDT", "spot")).toBe("BTC/USDT");
    expect(toSymbol("solusdc", "futures")).toBe("SOL/USDC:USDC");
    expect(toSymbol("ETHBTC", "spot")).toBe("ETH/BTC");
  });
  test("a spot pair asked with a perp suffix loses the suffix", () => {
    expect(toSymbol("BTC/USDT:USDT", "spot")).toBe("BTC/USDT");
  });
});
