import type { Tool } from "@/lib/tools/types";
import { errorText, fail, ok } from "@/lib/tools/types";
import { OutsideWorkspaceError } from "@/lib/tools/paths";
import { fileCard } from "../shared/cards";
import { sourcesProblem, type ReportSection, type ReportSource } from "./document";
import { writeReport } from "./write";

/* ReportExport: an analysis made in a conversation becomes a document of
   its own, dated and sourced — the natural deliverable of the Analyst and
   the Strategist. It writes in the workspace, hence it asks in "Ask before
   acting" mode. */

type Args = { title: string; summary?: string; sections: ReportSection[]; charts?: string[]; sources: ReportSource[]; format?: "html" | "markdown" };

export const reportExportTool: Tool<Args> = {
  name: "ReportExport",
  policy: { gated: true, subagent: true },
  description:
    "Writes a report as a standalone file in the workspace (reports/<date>-<title>.html, or .md): title, a one-line summary, sections in Markdown, the charts you drew (PNG paths of the workspace, embedded), and the table of sources — each with the date it was read. The date of generation and the notice \"Information, not investment advice\" are added. " +
    "Every figure in the report must come from a listed source. The HTML opens without the app and prints to PDF from a browser. Load the `report-export` skill first.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The report's title." },
      summary: { type: "string", description: "One or two sentences: the conclusion." },
      sections: {
        type: "array",
        items: { type: "object", properties: { heading: { type: "string" }, markdown: { type: "string" } }, required: ["heading", "markdown"], additionalProperties: false },
        description: "The body, section by section, in Markdown (tables allowed).",
      },
      charts: { type: "array", items: { type: "string" }, description: "PNG or JPEG files of the workspace to embed (Chart's output)." },
      sources: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, date: { type: "string" } }, required: ["name", "date"], additionalProperties: false },
        description: "Every source used: its name, a link if any, and when it was read (e.g. \"BytNode get_market_data\", \"2026-09-23 10:00 UTC\").",
      },
      format: { type: "string", enum: ["html", "markdown"], description: "Default html." },
    },
    required: ["title", "sections", "sources"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (args.sections.length === 0) return fail("A report needs at least one section.");
    const problem = sourcesProblem(args.sources);
    if (problem) return fail(problem);
    try {
      const { rel } = await writeReport({ ...args, workspace: ctx.workspace, scope: ctx.scope, author: "BytNode-AI" });
      return {
        ...ok(`Report written: ${rel} (${args.sections.length} section${args.sections.length > 1 ? "s" : ""}, ${args.charts?.length ?? 0} chart${(args.charts?.length ?? 0) > 1 ? "s" : ""}, ${args.sources.length} source${args.sources.length > 1 ? "s" : ""}). The user can open it from the thread.`),
        card: fileCard(args.title, rel),
      };
    } catch (e) {
      return fail(e instanceof OutsideWorkspaceError ? e.message : errorText(e));
    }
  },
};
