import { describe, expect, test } from "vitest";
import { exchangePromptSection } from "./prompt";
import type { ExchangeAccount } from "@/lib/domain/types";

const bybit: ExchangeAccount = { id: "x1", exchange: "bybit", label: "Bybit-main", apiKey: "a", secret: "b", password: "", testnet: false };

describe("exchangePromptSection", () => {
  test("no account configured: nothing", () => {
    expect(exchangePromptSection([], "mcp")).toEqual([]);
    expect(exchangePromptSection(undefined, "natif", 0)).toEqual([]);
  });
  test("accounts exist but none is attached: the agent must say so, not work around it", () => {
    const lines = exchangePromptSection([], "mcp", 2).join("\n");
    expect(lines).toContain("2 exchange accounts in BytNode-AI, but none is attached");
    expect(lines).toContain("Settings → Agents → Edit");
    expect(lines).toContain("Do not look for a key");
  });
  test("one attached account: the tools, the exchange's limits, the discipline", () => {
    const lines = exchangePromptSection([bybit], "mcp").join("\n");
    expect(lines).toContain("Bybit-main (bybit, LIVE)");
    expect(lines).toContain("ExchangeBalance");
    expect(lines).toContain("Limits:");
    expect(lines).toContain("Bybit: no Transfer");
    expect(lines).toContain("Funding wallet");
  });
  test("a sub-agent: read-only, no action tool named", () => {
    const lines = exchangePromptSection([bybit], "natif", 0, true).join("\n");
    expect(lines).toContain("read-only");
    expect(lines).toContain("ExchangeBalance");
    expect(lines).not.toContain("PlaceOrder");
    expect(lines).not.toContain("Transfer");
    expect(lines).toContain("always name `account`");
    expect(exchangePromptSection([], "mcp", 2, true)).not.toEqual([]);
  });
});
