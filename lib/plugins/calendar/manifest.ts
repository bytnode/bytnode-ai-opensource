import type { PluginManifest } from "@/lib/domain/plugins";

export const calendarManifest: PluginManifest = {
  id: "calendar",
  name: "Market calendar",
  version: "1.0.0",
  tier: "core",
  category: "market",
  summary: "The coming market events, sourced, kept up to date",
  description:
    "A local table of market events your agents search in an instant: central-bank decisions and macro figures, token unlocks, listings and delistings, upgrades and forks, project events — each with the source that announces it and the date it was collected. An agent of yours fills it in the background (every day for the next 7 days, every week for the next 30), searching the web; an event it cannot source is rejected. Options and futures expiries (Deribit, CME) are computed from the venues' schedules. The most important events of the next 48 hours are in your agents' prompt.",
  requires: ["scheduler"],
  optional: ["watchlist"],
  needs: [],
  config: {
    type: "object",
    properties: {
      agent: { type: "string", title: "Collecting agent", description: "The agent that searches the web for the events; each collection uses its model (or its subscription).", default: "", format: "agent" },
      daily: { type: "string", title: "Collection of the next 7 days", description: "`daily at 07:00`, `every 12 hours`…", default: "daily at 07:00", format: "frequency" },
      weekly: { type: "string", title: "Collection of the next 30 days", description: "`every monday at 07:30`…", default: "every monday at 07:30", format: "frequency" },
    },
  },
  views: [{ id: "calendar", title: "Calendar", description: "The week's market events, by day, filtered by category, importance and your watchlist." }],
  data: "The collected events (date, title, assets, importance, source URL, collection date) and the last collection's summary.",
};
