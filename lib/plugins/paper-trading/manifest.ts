import type { PluginManifest } from "@/lib/domain/plugins";

export const paperTradingManifest: PluginManifest = {
  id: "paper-trading",
  name: "Paper trading",
  version: "1.0.0",
  tier: "core",
  category: "portfolio",
  summary: "Trade with simulated money, never real funds",
  forAgents: "Simulated portfolios with fake money — spot and futures, market and limit orders at live prices. Never real funds, never a real order.",
  description:
    "A simulated portfolio to try a strategy, move from a backtest toward real trading without risk, or discover the app without giving an exchange key. Orders take the same shape as real ones — market or limit, spot or futures with leverage — and fill at the current BytNode price (or your exchange's), with the fees and slippage you set; a limit waits until the market reaches it. Every paper order carries a PAPER badge in the thread, and the agents always say that a paper result is simulated, never a real performance.",
  requires: [],
  optional: ["report-export"],
  needs: [],
  config: {
    type: "object",
    properties: {
      capital: { type: "number", title: "Starting capital (USDT)", description: "The paper cash of a new or reset portfolio.", default: 10_000, minimum: 100, maximum: 10_000_000 },
      feePercent: { type: "number", title: "Fee per fill (%)", description: "Charged on every fill, like an exchange's taker fee.", default: 0.1, minimum: 0, maximum: 1 },
      slippagePercent: { type: "number", title: "Slippage (%)", description: "How much worse than the current price a market order fills.", default: 0.05, minimum: 0, maximum: 2 },
    },
  },
  views: [{ id: "paper-trading", title: "Paper trading", description: "Simulated balances, positions, orders, result and history." }],
  data: "The simulated portfolio: its paper balances, positions, orders and fills.",
};
