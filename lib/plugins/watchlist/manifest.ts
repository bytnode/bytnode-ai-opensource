import type { PluginManifest } from "@/lib/domain/plugins";

export const watchlistManifest: PluginManifest = {
  id: "watchlist",
  name: "Watchlist",
  version: "1.0.0",
  tier: "core",
  category: "market",
  summary: "The assets you follow, known to your agents",
  forAgents: "The list of assets the user follows, shared by all their agents: \"my watchlist\" means these symbols.",
  description:
    "One list of the assets you follow, shared by all your agents: \"how is my watchlist doing this morning?\" works without saying which. Each asset shows its price and its 24 h and 7 d changes, from BytNode (or from your exchange for a pair BytNode does not cover). The agents see the symbols in their prompt, and can add or remove one when you ask. Alerts and the calendar use it as their default filter.",
  requires: [],
  optional: [],
  needs: [],
  config: { type: "object", properties: {} },
  views: [{ id: "watchlist", title: "Watchlist", description: "Your assets, their price and their 24 h / 7 d change." }],
  data: "Your followed assets: symbol, note, tags, date added.",
};
