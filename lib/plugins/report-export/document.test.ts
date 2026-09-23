import { describe, expect, it } from "vitest";
import { DISCLAIMER, reportHtml, reportMarkdown, slug, sourcesProblem, type Report } from "./document";
import { markdownToHtml } from "./markdown";

const report: Report = {
  title: "BTC — weekly outlook",
  summary: "Range-bound; funding cooled.",
  sections: [{ heading: "Market", markdown: "Price **64 000**, see [BytNode](https://bytnode.com).\n\n| Level | Price |\n|---|---:|\n| R1 | 66 000 |" }],
  images: [{ name: "out/charts/btc.png", dataUrl: "data:image/png;base64,AAAA", rel: "../out/charts/btc.png" }],
  sources: [{ name: "BytNode get_market_data", url: "https://api.bytnode.com", date: "2026-09-23 10:00 UTC" }],
  generatedAt: new Date("2026-09-23T10:05:00Z"),
  author: "BytNode-AI · Nova (Analyst)",
};

describe("markdownToHtml", () => {
  it("renders what a report uses", () => {
    const html = markdownToHtml("## Title\n\nA **bold** and *italic* `code` [link](https://x.org).\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---\n\n```\nx < 1\n```");
    expect(html).toContain("<h3>Title</h3>");
    expect(html).toContain("<strong>bold</strong> and <em>italic</em> <code>code</code> <a href=\"https://x.org\">link</a>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<pre><code>x &lt; 1</code></pre>");
  });

  it("renders GFM tables", () => {
    expect(markdownToHtml("| A | B |\n|---|---|\n| 1 | 2 |")).toBe("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  });

  it("never lets HTML or script through", () => {
    const html = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toMatch(/<script|<img|href="javascript/);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("report documents", () => {
  it("HTML: standalone, dated, sourced, with the disclaimer", () => {
    const html = reportHtml(report);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>BTC — weekly outlook</title>");
    expect(html).toContain("Generated 2026-09-23 10:05 UTC · BytNode-AI · Nova (Analyst)");
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('<a href="https://api.bytnode.com">BytNode get_market_data</a></td><td>2026-09-23 10:00 UTC</td>');
    expect(html).toContain(DISCLAIMER);
    expect(html).not.toMatch(/<script|<link|src="http/);
  });

  it("Markdown: the same content", () => {
    const md = reportMarkdown(report);
    expect(md).toContain("# BTC — weekly outlook");
    expect(md).toContain("![out/charts/btc.png](../out/charts/btc.png)");
    expect(md).toContain("| [BytNode get_market_data](https://api.bytnode.com) | 2026-09-23 10:00 UTC |");
  });

  it("slugs and source checks", () => {
    expect(slug("BTC — weekly outlook")).toBe("btc-weekly-outlook");
    expect(slug("Élan: été!")).toBe("elan-ete");
    expect(slug("***")).toBe("report");
    expect(sourcesProblem([])).toMatch(/at least one/);
    expect(sourcesProblem([{ name: "X", date: "" }])).toMatch(/no date/);
    expect(sourcesProblem([{ name: "X", date: "d", url: "ftp://x" }])).toMatch(/http\(s\)/);
    expect(sourcesProblem(report.sources)).toBeNull();
  });
});
