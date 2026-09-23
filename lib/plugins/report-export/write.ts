import fs from "node:fs/promises";
import path from "node:path";
import type { Scope } from "@/lib/tools/paths";
import { displayPath, resolvePath } from "@/lib/tools/paths";
import { reportHtml, reportMarkdown, slug, type ReportImage, type ReportSection, type ReportSource } from "./document";

/* ---------------------------------------------------------------------------
   Writing a report in the workspace: `reports/<date>-<title>.html` (or
   .md), never over an existing one. The charts are read from the
   workspace — through its path guard, like any file tool — and embedded.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export type WriteInput = {
  workspace: string;
  scope: Scope;
  title: string;
  summary?: string;
  sections: ReportSection[];
  /** Images of the workspace (PNG, JPEG), relative paths. */
  charts?: string[];
  sources: ReportSource[];
  format?: "html" | "markdown";
  author?: string;
};

export type Written = { abs: string; rel: string };

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 12;

async function freePath(base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = `${base}${n > 1 ? `-${n}` : ""}.${ext}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

export async function writeReport(input: WriteInput): Promise<Written> {
  const now = new Date();
  const format = input.format ?? "html";
  const reportsDir = resolvePath(input.workspace, "reports", input.scope);
  const images: ReportImage[] = [];
  for (const chart of (input.charts ?? []).slice(0, MAX_IMAGES)) {
    const abs = resolvePath(input.workspace, chart, input.scope);
    const type = IMAGE_TYPES[path.extname(abs).toLowerCase()];
    if (!type) throw new Error(`Only PNG or JPEG images can go into a report: ${chart}`);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) throw new Error(`Image not found: ${chart}`);
    if (stat.size > MAX_IMAGE) throw new Error(`Image too large for a report (over 5 MB): ${chart}`);
    images.push({
      name: displayPath(input.workspace, abs),
      dataUrl: format === "html" ? `data:${type};base64,${(await fs.readFile(abs)).toString("base64")}` : "",
      rel: path.relative(reportsDir, abs).split(path.sep).join("/"),
    });
  }
  const doc = { title: input.title, summary: input.summary, sections: input.sections, images, sources: input.sources, generatedAt: now, author: input.author };
  await fs.mkdir(reportsDir, { recursive: true });
  const target = await freePath(path.join(reportsDir, `${now.toISOString().slice(0, 10)}-${slug(input.title)}`), format === "html" ? "html" : "md");
  await fs.writeFile(target, format === "html" ? reportHtml(doc) : reportMarkdown(doc));
  return { abs: target, rel: displayPath(input.workspace, target) };
}
