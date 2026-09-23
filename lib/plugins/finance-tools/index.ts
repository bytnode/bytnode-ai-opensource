import { definePlugin } from "../core/contract";
import { financeToolsManifest } from "./manifest";
import { saveMarketDataTool } from "./save-market-data";
import { chartTool } from "./chart";
import { backtestTool } from "./backtest";

/* Charts and backtests: the finance tool family that used to be built into
   the core, now a plugin — the first existing family migrated, which
   proves the contract on real tools. Same tools, same behaviour; what they
   write lands in the agent's workspace, through its path guard. */
export const financeToolsPlugin = definePlugin({
  manifest: financeToolsManifest,
  setup(ctx) {
    ctx.tool(saveMarketDataTool);
    ctx.tool(chartTool);
    ctx.tool(backtestTool);
    ctx.prompt(() =>
      [
        "Charts and backtests (BytNode-AI tools, use them rather than a home-made script):",
        "- SaveMarketData: calls a BytNode tool and saves the table as CSV, without the rows going through the conversation. For any series longer than a few dozen rows.",
        "- Chart: draws a PNG chart from a CSV (candles, volume, indicators, markers, levels); the user sees it in the thread, and so do you.",
        "- Backtest: BytNode-AI's standard backtest engine; you only write `signal(df)` (and `stop_distance(df)`). Never rewrite an engine.",
      ].join("\n"),
    );
  },
});
