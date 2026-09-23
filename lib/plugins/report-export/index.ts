import path from "node:path";
import { PROJECT_ROOT } from "@/lib/server/workspace";
import { definePlugin } from "../core/contract";
import { reportExportManifest } from "./manifest";
import { reportExportTool } from "./report-export";
import type { ReportService } from "./service";
import { writeReport } from "./write";

/* Report export: the tool for the agents, the same writer as a service for
   the views that export (portfolio, paper trading), and a skill on how a
   report is built. */
export const reportExportPlugin = definePlugin({
  manifest: reportExportManifest,
  setup(ctx) {
    ctx.tool(reportExportTool);
    ctx.skills(path.join(PROJECT_ROOT, "lib", "plugins", "report-export", "skills"));
    ctx.provide<ReportService>(() => ({ write: writeReport }));
    ctx.prompt(() => "Report export: when the user wants to keep or share an analysis, write it with ReportExport (load the `report-export` skill first) — every figure sourced and dated.");
  },
});
