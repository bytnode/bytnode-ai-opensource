import type { PluginManifest } from "@/lib/domain/plugins";

export const positionCalcManifest: PluginManifest = {
  id: "position-calc",
  name: "Position calculator",
  version: "1.0.0",
  tier: "core",
  category: "portfolio",
  summary: "Size, liquidation price and risk/reward before a trade",
  description:
    "Reliable figures before any order. How much to buy for the risk you accept, where a leveraged position would be liquidated, and what each target pays for what the stop risks — fees included. The agent runs these before it proposes an order; you can ask for them directly too. The liquidation price is an estimate: exchanges use tiered margin tables, and the assumptions are always shown.",
  requires: [],
  optional: [],
  needs: [],
  config: {
    type: "object",
    properties: {
      feePercent: {
        type: "number",
        title: "Fees per side (%)",
        description: "Used when the agent gives none: your exchange's taker fee, in percent (0.06 = 0.06 %).",
        default: 0.06,
        minimum: 0,
        maximum: 1,
      },
    },
  },
  views: [],
  data: null,
};
