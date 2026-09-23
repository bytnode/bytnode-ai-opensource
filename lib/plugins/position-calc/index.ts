import { definePlugin } from "../core/contract";
import { positionCalcManifest } from "./manifest";
import { positionSizeTool } from "./position-size";
import { liquidationPriceTool } from "./liquidation-price";
import { riskRewardTool } from "./risk-reward";

/* The position calculator: three pure tools, no data, no network. The
   first plugin, and the proof of the contract. */
export const positionCalcPlugin = definePlugin({
  manifest: positionCalcManifest,
  setup(ctx) {
    const fee = () => Number(ctx.config().feePercent) / 100;
    ctx.tool(positionSizeTool(fee));
    ctx.tool(liquidationPriceTool);
    ctx.tool(riskRewardTool(fee));
    ctx.prompt(({ subagent }) =>
      subagent
        ? "Position calculator: PositionSize, LiquidationPrice and RiskReward give sizes, liquidation estimates and reward/risk ratios — use them instead of computing by hand."
        : "Position calculator: before proposing any order, size it with PositionSize (from the capital and the risk the user accepts), check LiquidationPrice for a leveraged position, and judge the targets with RiskReward. Quote their figures; never size an order by hand.",
    );
  },
});
