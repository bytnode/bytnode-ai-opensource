import type { PluginManifest } from "@/lib/domain/plugins";

export const financeToolsManifest: PluginManifest = {
  id: "finance-tools",
  name: "Charts and backtests",
  version: "1.0.0",
  tier: "core",
  category: "tools",
  summary: "Market data to CSV, charts, the standard backtest engine",
  forAgents: "Saves market data to CSV in the workspace, draws charts, and runs backtests with the standard engine.",
  description:
    "The agent's quantitative workbench. SaveMarketData writes a BytNode series straight to a CSV in the workspace — thousands of candles without going through the conversation. Chart draws it as a PNG (candles, volume, indicators, markers, levels) that you see in the thread. Backtest runs a strategy the agent writes in a few lines through BytNode-AI's standard engine: next-candle execution, fees, slippage, funding, sizing by risk, in and out of sample, with the equity curve. The backtest needs Python 3 with pandas and numpy.",
  requires: [],
  optional: [],
  needs: [],
  config: { type: "object", properties: {} },
  views: [],
  data: null,
};
