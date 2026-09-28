import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harness, type Harness } from "../test-fixture";
import { financeToolsPlugin } from "../finance-tools";
import { reportExportPlugin } from ".";

let h: Harness;
afterEach(async () => h?.close());

/* A 1×1 PNG. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

const args = {
  title: "BTC — weekly outlook",
  summary: "Range-bound.",
  sections: [{ heading: "Market", markdown: "Price **64 000**." }],
  charts: ["out/charts/btc.png"],
  sources: [{ name: "BytNode get_market_data", date: "2026-09-23 10:00 UTC" }],
};

describe("report-export plugin", () => {
  it("writes a standalone HTML report in the workspace, with a card to open it", async () => {
    h = await harness([financeToolsPlugin, reportExportPlugin]);
    await fs.mkdir(path.join(h.root, "out", "charts"), { recursive: true });
    await fs.writeFile(path.join(h.root, "out", "charts", "btc.png"), PNG);
    const r = await h.tool("ReportExport").execute(args, h.ctx());
    expect(r.ok).toBe(true);
    const rel = (r.card?.data as { path: string }).path;
    expect(rel).toMatch(/^reports\/\d{4}-\d{2}-\d{2}-btc-weekly-outlook\.html$/);
    const html = await fs.readFile(path.join(h.root, rel), "utf8");
    expect(html).toContain("<strong>64 000</strong>");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("Information, not investment advice");
    /* A second one never overwrites the first. */
    const again = await h.tool("ReportExport").execute(args, h.ctx());
    expect((again.card?.data as { path: string }).path).toMatch(/-2\.html$/);
  });

  it("refuses a report without dated sources, and an image outside the workspace", async () => {
    h = await harness([financeToolsPlugin, reportExportPlugin]);
    expect((await h.tool("ReportExport").execute({ ...args, sources: [] }, h.ctx())).output).toMatch(/at least one/);
    const out = await h.tool("ReportExport").execute({ ...args, charts: ["../../secret.png"] }, h.ctx());
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/outside the workspace/);
  });

  it("runs without the charts plugin: every plugin is independent", async () => {
    h = await harness([financeToolsPlugin, reportExportPlugin], { "finance-tools": { enabled: false, config: {}, agentIds: null } });
    expect(h.runtime.isRunning("report-export")).toBe(true);
    expect(h.runtime.tools(null).map((t) => t.name)).toContain("ReportExport");
  });
});
