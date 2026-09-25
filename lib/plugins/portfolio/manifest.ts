import type { PluginManifest } from "@/lib/domain/plugins";
import { CURRENCIES } from "../shared/fx";

export const portfolioManifest: PluginManifest = {
  id: "portfolio",
  name: "Portfolio",
  version: "1.0.0",
  tier: "core",
  category: "portfolio",
  summary: "One view of all your exchange accounts",
  forAgents: "The user's real holdings across all their exchange accounts, valued in their currency, and how the total evolved. Read-only.",
  description:
    "\"How much do I have, and how did it do?\" across every exchange account you allowed: balances of all wallets (spot, futures, funding), valued in the currency you choose, split by asset and by account, with the open positions. Testnet accounts are shown apart and never added to the total; an asset without a price is listed, never valued at zero in silence; an account that cannot be read is flagged without blocking the others. A daily snapshot of the total (while the app is open) draws the evolution. Values come from BytNode, or from your exchange when BytNode does not cover an asset.",
  requires: [],
  optional: ["scheduler", "report-export"],
  needs: ["exchange-account"],
  config: {
    type: "object",
    properties: {
      currency: { type: "string", title: "Reference currency", description: "Totals are shown in it; rates from Kraken's public market.", default: "USD", enum: [...CURRENCIES] },
      snapshotAt: { type: "string", title: "Daily snapshot at", description: "Local time. Taken while the app is open; a missed one is taken when it opens.", default: "23:55", format: "time" },
    },
  },
  views: [{ id: "portfolio", title: "Portfolio", description: "Total value, evolution, split by asset and by account, open positions." }],
  data: "One snapshot a day: the date, the total, the split by asset and each live account's total (under its internal id) in USD — no key, no account name. The groups of accounts you make: a name and the accounts' internal ids.",
};
