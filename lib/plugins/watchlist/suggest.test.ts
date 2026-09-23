import { describe, expect, it } from "vitest";
import { knownCandidates, mergeCandidates, queryBase, suggest, type Candidate } from "./suggest";

const c = (symbol: string, sources: string[], name?: string): Candidate => ({ symbol, base: symbol.split("/")[0], name, sources });

describe("queryBase", () => {
  it("reads a ticker from what is typed", () => {
    expect(queryBase("eth")).toBe("ETH");
    expect(queryBase(" ETH/USDT ")).toBe("ETH");
    expect(queryBase("ethusdt")).toBe("ETH");
    expect(queryBase("sol-usdc")).toBe("SOL");
    expect(queryBase("")).toBe("");
  });
});

describe("mergeCandidates", () => {
  it("merges a pair's sources and names it", () => {
    const merged = mergeCandidates([[c("BTC/USDT", ["bytnode"], "Bitcoin")], [c("BTC/USDT", ["binance"]), c("PEPE/USDT", ["binance"])]]);
    expect(merged).toEqual([
      { symbol: "BTC/USDT", base: "BTC", name: "Bitcoin", sources: ["bytnode", "binance"] },
      { symbol: "PEPE/USDT", base: "PEPE", name: "Pepe", sources: ["binance"] },
    ]);
  });
});

describe("suggest", () => {
  const catalog = mergeCandidates([
    [c("BTC/USDT", ["bytnode"], "Bitcoin"), c("ETH/USDT", ["bytnode"], "Ethereum"), c("SOL/USDT", ["bytnode"], "Solana")],
    [c("ETH/USDC", ["kraken"]), c("ETHFI/USDT", ["binance"]), c("BTC/USDC", ["kraken"]), c("WBTC/USDT", ["binance"])],
  ]);

  it("proposes from the first letter, the ticker itself first", () => {
    expect(suggest("e", catalog).map((x) => x.symbol)).toEqual(["ETH/USDT", "ETH/USDC", "ETHFI/USDT"]);
    expect(suggest("btc", catalog).map((x) => x.symbol)).toEqual(["BTC/USDT", "BTC/USDC", "WBTC/USDT"]);
  });

  it("finds an asset by its name", () => {
    expect(suggest("sola", catalog).map((x) => x.symbol)).toEqual(["SOL/USDT"]);
    expect(suggest("bitc", catalog)[0].symbol).toBe("BTC/USDT");
  });

  it("proposes nothing for nothing, and stops at the limit", () => {
    expect(suggest("  ", catalog)).toEqual([]);
    expect(suggest("e", catalog, 2)).toHaveLength(2);
  });

  it("lists only what starts with a single letter", () => {
    expect(suggest("t", catalog)).toEqual([]);
    expect(suggest("th", catalog).map((x) => x.base)).toEqual(["ETH", "ETH", "ETHFI"]);
  });

  it("falls back on well-known assets", () => {
    expect(suggest("do", knownCandidates()).map((x) => x.base)).toEqual(["DOGE", "DOT"]);
  });
});
