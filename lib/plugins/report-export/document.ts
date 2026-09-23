import { escapeHtml, markdownToHtml } from "./markdown";

/* ---------------------------------------------------------------------------
   A report as a document that stands on its own.

   HTML: one file, style inline, images embedded as data URIs — it opens
   offline, prints to PDF from any browser, and loads nothing from
   anywhere. Markdown: the same content, images next to it. Both carry what
   a report must: when it was generated, where every figure comes from and
   when that source was read, and that it is information, not investment
   advice. Pure, tested.
--------------------------------------------------------------------------- */

export type ReportSource = { name: string; url?: string; date: string };
export type ReportSection = { heading: string; markdown: string };
export type ReportImage = { name: string; dataUrl: string; rel: string };

export type Report = {
  title: string;
  summary?: string;
  sections: ReportSection[];
  images: ReportImage[];
  sources: ReportSource[];
  generatedAt: Date;
  /** Who produced it: "BytNode-AI · Nova (Analyst)". */
  author?: string;
};

export const DISCLAIMER = "Information, not investment advice. Figures come from the sources listed, at the dates shown; markets move.";

/** A file-name slug: "BTC — weekly outlook" → "btc-weekly-outlook". */
export const slug = (title: string): string =>
  title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";

/** Every report lists its sources, each with a name and a date. */
export function sourcesProblem(sources: ReportSource[]): string | null {
  if (sources.length === 0) return "A report lists its sources: give at least one, with the date it was read.";
  const bad = sources.find((s) => !s.name.trim() || !s.date.trim());
  if (bad) return `Every source needs a name and a date (the one read at ${bad.date || "?"} has ${bad.name.trim() ? "no date" : "no name"}).`;
  const link = sources.find((s) => s.url && !/^https?:\/\//.test(s.url));
  return link ? `A source link must be http(s): ${link.url}` : null;
}

const STYLE = `
:root{color-scheme:light}body{margin:0;background:#f4f4f2;color:#161616;font:15px/1.6 Inter,"Segoe UI",system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 40px 64px;background:#fff}
h1{font:400 30px/1.15 Geist,Inter,"Segoe UI",sans-serif;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:#6b6b6b;font-size:13px;margin:0 0 28px}.summary{font-size:16px;border-left:3px solid #161616;padding:4px 0 4px 14px;margin:0 0 28px}
h2{font-size:19px;margin:34px 0 10px;letter-spacing:-.01em}h3,h4,h5{font-size:16px;margin:22px 0 8px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13.5px}th,td{border-bottom:1px solid #e3e3e0;padding:7px 9px;text-align:left}th{color:#555;font-weight:600}
code{font:12.5px "IBM Plex Mono",Consolas,monospace;background:#f1f1ee;padding:1px 4px;border-radius:4px}pre{background:#f1f1ee;padding:12px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:12px 0;padding-left:14px;border-left:3px solid #d6d6d2;color:#444}figure{margin:18px 0}figure img{max-width:100%;border:1px solid #e3e3e0;border-radius:6px}figcaption{color:#6b6b6b;font-size:12px}
a{color:#1f4fd1}.sources td:last-child{white-space:nowrap}.disclaimer{margin-top:34px;padding-top:14px;border-top:1px solid #e3e3e0;color:#6b6b6b;font-size:12.5px}
@media print{body{background:#fff}main{padding:0}}`;

export function reportHtml(r: Report): string {
  const stamp = r.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const body = [
    `<h1>${escapeHtml(r.title)}</h1>`,
    `<p class="meta">Generated ${stamp}${r.author ? ` · ${escapeHtml(r.author)}` : ""}</p>`,
    r.summary ? `<p class="summary">${escapeHtml(r.summary)}</p>` : "",
    ...r.sections.map((s) => `<section><h2>${escapeHtml(s.heading)}</h2>\n${markdownToHtml(s.markdown)}</section>`),
    ...r.images.map((im) => `<figure><img src="${im.dataUrl}" alt="${escapeHtml(im.name)}"><figcaption>${escapeHtml(im.name)}</figcaption></figure>`),
    `<section><h2>Sources</h2><table class="sources"><thead><tr><th>Source</th><th>Read</th></tr></thead><tbody>${r.sources
      .map((s) => `<tr><td>${s.url ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.name)}</a>` : escapeHtml(s.name)}</td><td>${escapeHtml(s.date)}</td></tr>`)
      .join("")}</tbody></table></section>`,
    `<p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>`,
  ];
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(r.title)}</title><style>${STYLE}</style></head><body><main>\n${body.filter(Boolean).join("\n")}\n</main></body></html>\n`;
}

export function reportMarkdown(r: Report): string {
  const stamp = r.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return [
    `# ${r.title}`,
    "",
    `_Generated ${stamp}${r.author ? ` · ${r.author}` : ""}_`,
    ...(r.summary ? ["", `> ${r.summary}`] : []),
    ...r.sections.flatMap((s) => ["", `## ${s.heading}`, "", s.markdown.trim()]),
    ...r.images.flatMap((im) => ["", `![${im.name}](${im.rel})`]),
    "",
    "## Sources",
    "",
    "| Source | Read |",
    "|---|---|",
    ...r.sources.map((s) => `| ${s.url ? `[${s.name}](${s.url})` : s.name} | ${s.date} |`),
    "",
    `_${DISCLAIMER}_`,
    "",
  ].join("\n");
}
