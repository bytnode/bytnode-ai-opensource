import { describe, expect, it } from "vitest";
import type { Tool, ToolContext } from "@/lib/tools/types";
import { PluginRuntime } from "../core/runtime";
import type { PluginStore } from "../core/store";
import type { Confirmation } from "@/lib/domain/plugins";
import { positionCalcPlugin } from ".";

/* The calculator through a real runtime, as an agent reaches it. */
async function tools(config: Record<string, number> = {}) {
  const rt = new PluginRuntime([positionCalcPlugin], {
    background: false,
    reservedNames: new Set(),
    store: () => ({}) as PluginStore,
    notifications: { add: async () => ({}) as never },
    confirmations: { request: async () => ({}) as Confirmation },
    session: () => null,
    log: () => {},
  });
  await rt.apply({ "position-calc": { enabled: true, config, agentIds: null } });
  const byName = new Map(rt.tools(null).map((t) => [t.name, t as Tool]));
  const prompt = await rt.prompts(null, { agentId: "a", engine: "native", subagent: false });
  return { byName, prompt };
}

const ctx = {} as ToolContext;

describe("position-calc plugin", () => {
  it("brings three read-only tools, available to sub-agents, and a prompt line", async () => {
    const { byName, prompt } = await tools();
    expect([...byName.keys()]).toEqual(["PositionSize", "LiquidationPrice", "RiskReward"]);
    for (const t of byName.values()) expect(t.policy).toEqual({ readOnly: true, subagent: true });
    expect(prompt[0]).toMatch(/before proposing any order, size it with PositionSize/);
  });

  it("PositionSize uses the fee setting and returns a card", async () => {
    const { byName } = await tools({ feePercent: 0 });
    const r = await byName.get("PositionSize")!.execute({ capital: 10_000, riskPercent: 1, entry: 50_000, stop: 49_000, side: "long" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Size: 0.1 (base asset)");
    expect(r.output).toContain("Implied leverage: ×0.5");
    expect(r.card).toMatchObject({ kind: "facts", data: { title: "Position size · long" } });
  });

  it("LiquidationPrice reads the exchange's first tier and says so", async () => {
    const { byName } = await tools();
    const r = await byName.get("LiquidationPrice")!.execute({ side: "long", entry: 50_000, leverage: 10, exchange: "binance" }, ctx);
    expect(r.output).toContain("Liquidation price: 45180.723");
    expect(r.output).toContain("maintenance margin 0.40 % (Binance's first tier)");
    const bad = await byName.get("LiquidationPrice")!.execute({ side: "long", entry: 50_000 }, ctx);
    expect(bad).toEqual({ ok: false, output: "Isolated margin needs `leverage` (1 or more)." });
  });

  it("RiskReward: one row per target", async () => {
    const { byName } = await tools({ feePercent: 0 });
    const r = await byName.get("RiskReward")!.execute({ side: "long", entry: 100, stop: 95, targets: [110, 115] }, ctx);
    expect(r.output).toContain("Target 110: 2.00 R, break-even win rate 33.3 %");
    expect(r.card).toMatchObject({ kind: "table", data: { rows: [["110", "2.00 R", "33.3 %"], ["115", "3.00 R", "25.0 %"]] } });
  });
});
