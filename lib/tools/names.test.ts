import { describe, expect, it } from "vitest";
import { allowedForSubagent, alwaysAsks, isAlwaysAskTitle, isExchangeTool, isGated, summarizeCall } from "./names";

describe("outils exchange : qui demande", () => {
  it("les cinq outils d'ecriture sont gated ; trois demandent toujours", () => {
    for (const n of ["PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage"]) expect(isGated(n)).toBe(true);
    expect(isGated("ExchangeBalance")).toBe(false);
    expect(alwaysAsks("PlaceOrder")).toBe(true);
    expect(alwaysAsks("Transfer")).toBe(true);
    expect(alwaysAsks("CancelOrder")).toBe(false);
  });
  it("reconnait un titre d'agent externe", () => {
    expect(isAlwaysAskTitle("mcp__bytnode-ai__PlaceOrder")).toBe(true);
    expect(isAlwaysAskTitle("Read file")).toBe(false);
  });
  it("un sous-agent ne recoit jamais un outil qui engage des fonds", () => {
    for (const n of ["PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage", "Workflow"]) expect(allowedForSubagent(n)).toBe(false);
    for (const n of ["ExchangeBalance", "ExchangeTicker", "Bash", "Write"]) expect(allowedForSubagent(n)).toBe(true);
  });
  it("reconnait les outils exchange pour le badge", () => {
    expect(isExchangeTool("ExchangeTicker")).toBe(true);
    expect(isExchangeTool("SetLeverage")).toBe(true);
    expect(isExchangeTool("Bash")).toBe(false);
  });
});

describe("summarizeCall (exchange)", () => {
  it("PlaceOrder dit tout ce qu'on va autoriser", () => {
    expect(summarizeCall("PlaceOrder", { account: "Binance-main", side: "buy", amount: 0.05, symbol: "BTC/USDT", type: "market", leverage: 5, reduceOnly: true })).toBe(
      "Binance-main · BUY 0.05 BTC/USDT market ×5 reduceOnly",
    );
    expect(summarizeCall("PlaceOrder", { side: "sell", quoteAmount: 200, symbol: "ETH/USDT", type: "limit", price: 3000 })).toBe("SELL 200 (quote) ETH/USDT limit @ 3000");
  });
  it("les autres", () => {
    expect(summarizeCall("CancelOrder", { orderId: "42" })).toBe("#42");
    expect(summarizeCall("CancelOrder", { symbol: "BTC/USDT", all: true })).toBe("tous les ordres BTC/USDT");
    expect(summarizeCall("ClosePosition", { account: "A", symbol: "BTC/USDT", fraction: 0.5 })).toBe("A · BTC/USDT 50 %");
    expect(summarizeCall("ClosePosition", { symbol: "BTC/USDT" })).toBe("BTC/USDT");
    expect(summarizeCall("Transfer", { amount: 100, asset: "USDT", from: "spot", to: "futures" })).toBe("100 USDT spot → futures");
    expect(summarizeCall("SetLeverage", { symbol: "BTC/USDT", leverage: 10, marginMode: "isolated" })).toBe("BTC/USDT ×10 isolated");
    expect(summarizeCall("ExchangeBalance", { account: "A", market: "futures" })).toBe("A · futures");
    expect(summarizeCall("ExchangePositions", {})).toBe("futures");
    expect(summarizeCall("ExchangeOrders", { status: "open", symbol: "BTC/USDT" })).toBe("open BTC/USDT");
    expect(summarizeCall("ExchangeTicker", { symbol: "BTC/USDT" })).toBe("BTC/USDT");
  });
});
