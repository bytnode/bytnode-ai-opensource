import type { PluginManifest } from "@/lib/domain/plugins";

export const alertsManifest: PluginManifest = {
  id: "alerts",
  name: "Alerts",
  version: "2.0.0",
  tier: "core",
  category: "market",
  summary: "Be told when the market does what you are waiting for",
  forAgents: "Notifies the user when a market condition they chose becomes true: a price level, a change over a window, an indicator (RSI, EMA, MACD, Bollinger…), a funding rate, a position's P&L. Checked every minute while the app is open; it only notifies, never trades.",
  description:
    "\"Tell me if BTC goes above 70 000\", \"if the RSI 14 of ETH on the hour drops under 30\", \"when the 50-day EMA of SOL crosses its 200-day\", \"if the funding of ETH passes 0.05 %\", \"the day before an important event on my watchlist\", \"if my position gets within 3 % of liquidation\": an alert watches the price, its change, the funding, any indicator (RSI, EMA, SMA, MACD, Bollinger, stochastic, ATR, volume — your length, your timeframe) against a level or another indicator, and fires in the notification center — and on your desktop if you allowed it — without a conversation open. On one asset or on your whole watchlist, once or every time. One notification per crossing, never one per check, with a cooldown between two; an alert that cannot be checked (no price for the asset) says so instead of staying silent. Checked every minute while the app is open.",
  requires: [],
  optional: ["watchlist", "calendar"],
  needs: [],
  config: {
    type: "object",
    properties: {
      every: { type: "string", title: "Check the alerts", description: "`every 1 minute`, `every 5 minutes`…", default: "every 1 minute", format: "frequency" },
      cooldownMinutes: { type: "integer", title: "Quiet time after an alert fires (minutes)", description: "A recurring alert does not fire again sooner.", default: 60, minimum: 0, maximum: 1440 },
    },
  },
  views: [{ id: "alerts", title: "Alerts", description: "Your alerts, their state, and what fired lately." }],
  data: "Your alerts (asset, condition, state) and the last 500 times one fired.",
};
