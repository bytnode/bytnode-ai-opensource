import type { PluginManifest } from "@/lib/domain/plugins";

export const calendarManifest: PluginManifest = {
  id: "calendar",
  name: "Calendar",
  version: "2.0.0",
  tier: "core",
  category: "market",
  summary: "Market events and your tasks, written by your agents",
  description:
    "A local calendar your agents read in an instant and write when you ask: \"add the next FOMC and CPI dates\", \"remind me Friday to review my BTC position\". They add market events — central-bank decisions and macro figures, token unlocks, listings, upgrades, project events — each with the page that announces it (an event without a source is rejected), and your own tasks, reminders and deadlines; they change or remove them, and tick tasks off. A scheduled task can fill it too. Options and futures expiries (Deribit, CME) are computed from the venues' schedules, and your scheduled tasks' coming runs are shown. The most important events and your tasks of the next 48 hours are in your agents' prompt.",
  requires: [],
  optional: ["watchlist", "scheduler"],
  needs: [],
  config: { type: "object", properties: {} },
  views: [{ id: "calendar", title: "Calendar", description: "Your calendar: market events, your tasks and your scheduled tasks, by day or week, filtered by calendar, importance and your watchlist." }],
  data: "The entries your agents wrote (date, title, assets, importance, source, notes, the agent that wrote it). Expiries and scheduled runs are computed, not stored.",
};
