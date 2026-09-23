import { describe, expect, it } from "vitest";
import { NEVER_BACKGROUND, alwaysAsks, isAlwaysAskTitle, isExchangeTool, isWorkflowName, summarizeCall } from "./names";

describe("exchange tools: the core's floor", () => {
  it("three tools always ask", () => {
    expect(alwaysAsks("PlaceOrder")).toBe(true);
    expect(alwaysAsks("Transfer")).toBe(true);
    expect(alwaysAsks("ClosePosition")).toBe(true);
    expect(alwaysAsks("CancelOrder")).toBe(false);
  });
  it("recognises an external agent's title, core or declared", () => {
    expect(isAlwaysAskTitle("mcp__bytnode-ai__PlaceOrder")).toBe(true);
    expect(isAlwaysAskTitle("Read file")).toBe(false);
    expect(isAlwaysAskTitle("mcp__bytnode-ai__Payout", ["Payout"])).toBe(true);
  });
  it("Workflow and every exchange action stay out of reach of sub-agents", () => {
    for (const n of ["PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage", "Workflow"]) expect(NEVER_BACKGROUND.has(n)).toBe(true);
    for (const n of ["ExchangeBalance", "ExchangeTicker", "Bash", "Write"]) expect(NEVER_BACKGROUND.has(n)).toBe(false);
  });
  it("recognises a Workflow call, native or served over MCP", () => {
    for (const n of ["Workflow", "mcp__bytnode-ai__Workflow", "bytnode-ai/Workflow", "bytnode-ai.Workflow"]) expect(isWorkflowName(n)).toBe(true);
    for (const n of ["Workflows", "MyWorkflow", "Bash", "workflow"]) expect(isWorkflowName(n)).toBe(false);
    expect(summarizeCall("mcp__bytnode-ai__Workflow", { tasks: [{}, {}] })).toBe("2 sub-agents");
    expect(summarizeCall("Workflow", { tasks: [{}] })).toBe("1 sub-agent");
  });
  it("recognises the exchange tools for the badge", () => {
    expect(isExchangeTool("ExchangeTicker")).toBe(true);
    expect(isExchangeTool("SetLeverage")).toBe(true);
    expect(isExchangeTool("Bash")).toBe(false);
  });
});

describe("summarizeCall (exchange)", () => {
  it("PlaceOrder says everything that is about to be authorised", () => {
    expect(summarizeCall("PlaceOrder", { account: "Binance-main", side: "buy", amount: 0.05, symbol: "BTC/USDT", type: "market", leverage: 5, reduceOnly: true })).toBe(
      "Binance-main · BUY 0.05 BTC/USDT market ×5 reduceOnly",
    );
    expect(summarizeCall("PlaceOrder", { side: "sell", quoteAmount: 200, symbol: "ETH/USDT", type: "limit", price: 3000 })).toBe("SELL 200 (quote) ETH/USDT limit @ 3000");
  });
  it("the others", () => {
    expect(summarizeCall("CancelOrder", { orderId: "42" })).toBe("#42");
    expect(summarizeCall("CancelOrder", { symbol: "BTC/USDT", all: true })).toBe("all BTC/USDT orders");
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
