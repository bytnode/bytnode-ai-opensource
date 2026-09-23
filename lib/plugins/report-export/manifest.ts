import type { PluginManifest } from "@/lib/domain/plugins";

export const reportExportManifest: PluginManifest = {
  id: "report-export",
  name: "Report export",
  version: "1.0.0",
  tier: "core",
  category: "tools",
  summary: "An analysis, its charts and its dated sources as a standalone document",
  description:
    "Turns an analysis made in a conversation into a document you keep or share: a single HTML file (or Markdown) in the agent's workspace, under reports/, with the title, the summary, the sections, the charts embedded, the table of sources — each with the date it was read — the date of generation and the notice \"information, not investment advice\". It opens without the app, loads nothing from the internet, and prints to PDF from any browser. The portfolio and the paper trading use it for their \"Export\" button.",
  requires: ["finance-tools"],
  optional: [],
  needs: [],
  config: { type: "object", properties: {} },
  views: [],
  data: null,
};
