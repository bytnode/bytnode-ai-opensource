import type { PluginManifest } from "@/lib/domain/plugins";

export const dcaManifest: PluginManifest = {
  id: "dca",
  name: "Recurring purchases (DCA)",
  version: "1.0.0",
  tier: "core",
  category: "portfolio",
  summary: "Buy a fixed amount at regular intervals — simulated or real, always confirmed",
  description:
    "\"Buy 100 USDT of BTC every Monday\": a plan buys the same amount at each due date. In the paper portfolio, the purchases happen by themselves. On an exchange account, each due date PROPOSES the purchase in the notification center — the same confirmation as in a conversation, with the LIVE or TESTNET badge — and nothing is bought without your click. Before proposing, the plan checks the market is open, the amount is above the exchange's minimum and the balance is enough; a failure is said, never retried in a loop. A due date missed while the app was closed is proposed when it opens, never bought by itself. Each plan keeps its history: total invested, quantity, average price.",
  requires: ["scheduler", "paper-trading"],
  optional: [],
  needs: [],
  config: { type: "object", properties: {} },
  views: [{ id: "dca", title: "DCA", description: "Your recurring purchases: next due dates, average price, history." }],
  data: "Your plans (asset, amount, frequency, destination) and the history of their purchases.",
};
