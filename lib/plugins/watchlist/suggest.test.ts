import { describe, expect, it } from "vitest";
import { named, queryBase, suggest, type Candidate } from "./suggest";

const c = (symbol: string, name?: string): Candidate => ({ symbol, base: symbol.split("/")[0], name });

describe("queryBase", () => {
  it("reads a ticker from what is typed", () => {
    expect(queryBase("eth")).toBe("ETH");
    expect(queryBase(" ETH/USDT ")).toBe("ETH");
    expect(queryBase("ethusdt")).toBe("ETH");
    expect(queryBase("sol-usdc")).toBe("SOL");
    expect(queryBase("")).toBe("");
  });
});

describe("named", () => {
  it("keeps a pair once and names it", () => {
    expect(named([c("BTC/USDT", "Bitcoin"), c("BTC/USDT"), c("HYPE/USDT")])).toEqual([c("BTC/USDT", "Bitcoin"), c("HYPE/USDT", "Hyperliquid")]);
  });
});

describe("suggest", () => {
  const catalog = named([c("BTC/USDT", "Bitcoin"), c("ETH/USDT", "Ethereum"), c("SOL/USDT", "Solana"), c("SUI/USDT"), c("ETHFI/USDT"), c("WBTC/USDT")]);

  it("proposes from the first letter, the ticker itself first", () => {
    expect(suggest("e", catalog).map((x) => x.symbol)).toEqual(["ETH/USDT", "ETHFI/USDT"]);
    expect(suggest("btc", catalog).map((x) => x.symbol)).toEqual(["BTC/USDT", "WBTC/USDT"]);
    expect(suggest("s", catalog).map((x) => x.base)).toEqual(["SOL", "SUI"]);
  });

  it("finds an asset by its name", () => {
    expect(suggest("sola", catalog).map((x) => x.symbol)).toEqual(["SOL/USDT"]);
    expect(suggest("bitc", catalog)[0].symbol).toBe("BTC/USDT");
  });

  it("finds nothing for what BytNode does not cover", () => {
    expect(suggest("bbad/usdt", catalog)).toEqual([]);
    expect(suggest("  ", catalog)).toEqual([]);
  });

  it("lists only what starts with a single letter, and stops at the limit", () => {
    expect(suggest("t", catalog)).toEqual([]);
    expect(suggest("th", catalog).map((x) => x.base)).toEqual(["ETH", "ETHFI"]);
    expect(suggest("e", catalog, 1)).toHaveLength(1);
  });
});
