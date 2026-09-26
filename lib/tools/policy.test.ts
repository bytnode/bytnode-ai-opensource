import { describe, expect, it } from "vitest";
import type { Tool } from "./types";
import { describePolicy, mustAsk, policiesOf, policyIn, resolvePolicy } from "./policy";
import { bytnodeAiTools, generalTools } from "./registry";
import { saveMarketDataTool } from "@/lib/plugins/finance-tools/save-market-data";
import { chartTool } from "@/lib/plugins/finance-tools/chart";
import { backtestTool } from "@/lib/plugins/finance-tools/backtest";

describe("resolvePolicy", () => {
  it("a tool that declares nothing is sensitive", () => {
    expect(resolvePolicy("Anything")).toEqual({ readOnly: false, gated: true, alwaysAsk: false, subagent: false });
  });

  it("fills what is missing: a read-only tool does not ask", () => {
    expect(resolvePolicy("Look", { readOnly: true })).toEqual({ readOnly: true, gated: false, alwaysAsk: false, subagent: false });
    expect(resolvePolicy("Note", { gated: false, subagent: true })).toEqual({ readOnly: false, gated: false, alwaysAsk: false, subagent: true });
  });

  it("always asking means asking, and never for a sub-agent", () => {
    expect(resolvePolicy("Payout", { alwaysAsk: true, readOnly: true, subagent: true, gated: false })).toEqual({ readOnly: false, gated: true, alwaysAsk: true, subagent: false });
  });

  it("no declaration lowers the core's floor", () => {
    for (const name of ["PlaceOrder", "ClosePosition", "Transfer"]) {
      expect(resolvePolicy(name, { readOnly: true, gated: false, subagent: true })).toEqual({ readOnly: false, gated: true, alwaysAsk: true, subagent: false });
    }
    for (const name of ["Workflow", "CancelOrder", "SetLeverage"]) expect(resolvePolicy(name, { subagent: true }).subagent).toBe(false);
  });

  it("an unknown tool in the browser is treated as sensitive", () => {
    expect(policyIn({}, "Mystery").gated).toBe(true);
    expect(policyIn({ Read: resolvePolicy("Read", { readOnly: true }) }, "Read").gated).toBe(false);
  });

  it("who waits for the user", () => {
    const gated = resolvePolicy("Write", { gated: true });
    const funds = resolvePolicy("PlaceOrder");
    const read = resolvePolicy("Read", { readOnly: true });
    expect(mustAsk(gated, false)).toBe(true);
    expect(mustAsk(gated, true)).toBe(false);
    expect(mustAsk(funds, true)).toBe(true);
    expect(mustAsk(read, false)).toBe(false);
  });

  it("says the policy in plain words", () => {
    expect(describePolicy(resolvePolicy("PlaceOrder"))).toMatch(/Always confirmed/);
    expect(describePolicy(resolvePolicy("Read", { readOnly: true, subagent: true }))).toBe("Read-only, runs without asking · available to sub-agents and scheduled runs");
  });
});

/* The declarative policies must reproduce, tool for tool, what the core
   decided before they existed: the old `GATED_TOOLS` list, the three tools
   that always ask, and "a sub-agent gets everything but Workflow and the
   five exchange actions" — the finance tools now shipped by the
   finance-tools plugin included. */
describe("the core tools keep their behaviour", () => {
  const account = { id: "a", exchange: "binance", label: "A", apiKey: "", secret: "", password: "", testnet: true };
  const tools = [...generalTools("win32"), ...bytnodeAiTools({ exchangeAccounts: [account] }), saveMarketDataTool, chartTool, backtestTool] as Tool[];
  const policies = policiesOf(tools);

  it("every one of them declares its policy", () => {
    expect(tools.filter((t) => !t.policy).map((t) => t.name)).toEqual([]);
  });

  it("the same tools ask in ask mode", () => {
    const gated = Object.entries(policies)
      .filter(([, p]) => p.gated)
      .map(([n]) => n)
      .sort();
    expect(gated).toEqual(["Backtest", "Bash", "CancelOrder", "ClosePosition", "Edit", "Monitor", "NotebookEdit", "PlaceOrder", "PluginActivate", "PluginWrite", "PowerShell", "SetLeverage", "Transfer", "Workflow", "Write"]);
  });

  it("the same three always ask", () => {
    const always = Object.entries(policies)
      .filter(([, p]) => p.alwaysAsk)
      .map(([n]) => n)
      .sort();
    expect(always).toEqual(["ClosePosition", "PlaceOrder", "Transfer"]);
  });

  /* Nor the four tools a plugin is written with: that is a conversation
     with the user (the create-plugin skill starts with questions). */
  it("a sub-agent gets everything but Workflow, the exchange actions and the plugin writing", () => {
    const refused = Object.entries(policies)
      .filter(([, p]) => !p.subagent)
      .map(([n]) => n)
      .sort();
    expect(refused).toEqual(["CancelOrder", "ClosePosition", "PlaceOrder", "PluginActivate", "PluginCheck", "PluginRead", "PluginWrite", "SetLeverage", "Transfer", "Workflow"]);
  });
});
