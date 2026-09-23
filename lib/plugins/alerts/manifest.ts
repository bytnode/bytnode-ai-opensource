import type { PluginManifest } from "@/lib/domain/plugins";

export const alertsManifest: PluginManifest = {
  id: "alerts",
  name: "Alerts",
  version: "1.0.0",
  tier: "core",
  category: "market",
  summary: "Be told when the market does what you are waiting for",
  description:
    "\"Tell me if BTC goes above 70 000\", \"if SOL moves 5 % in a day\", \"if the funding of ETH passes 0.05 %\", \"the day before an important event on my watchlist\", \"if my position gets within 3 % of liquidation\": an alert fires in the notification center — and on your desktop if you allowed it — without a conversation open. On one asset or on your whole watchlist, once or every time. One notification per crossing, never one per check, with a cooldown between two; an alert that cannot be checked (no price for the asset) says so instead of staying silent. Checked every minute while the app is open.",
  requires: ["scheduler", "watchlist"],
  optional: ["calendar"],
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
