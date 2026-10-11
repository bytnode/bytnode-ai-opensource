import { describe, expect, it } from "vitest";
import { ActivityLog, ACTIVITY_MAX, displayName, stripTrace, traceOf, withTrace } from "./activity";
import { parseWorkflowReport, reportSection } from "./subagent";

describe("a sub-agent's steps", () => {
  it("records each tool call, with what it was asked, then how it went", () => {
    const log = new ActivityLog();
    expect(log.start("c1", "Read", { file_path: "data/btc.csv" })).toEqual({ id: "c1", name: "Read", summary: "data/btc.csv", status: "running" });
    log.start("c2", "Bash", { command: "python backtest.py", description: "Run the backtest" });
    expect(log.finish("c1", true)?.status).toBe("done");
    expect(log.finish("c2", false)?.status).toBe("failed");
    expect(log.finish("nope", true)).toBeNull();
    expect(log.steps.map((s) => s.status)).toEqual(["done", "failed"]);
  });
  it("reads a subscription agent's MCP tool by its plain name", () => {
    expect(displayName("mcp__bytnode-ai__Chart")).toBe("Chart");
    expect(displayName("Read")).toBe("Read");
    expect(new ActivityLog().start("x", "mcp__bytnode-ai__Chart", { title: "BTC 1h" }).summary).toBe("BTC 1h");
  });
  it("keeps the latest steps only", () => {
    const log = new ActivityLog();
    for (let i = 0; i < ACTIVITY_MAX + 5; i++) log.start(`c${i}`, "Glob", { pattern: `*${i}` });
    expect(log.steps).toHaveLength(ACTIVITY_MAX);
    expect(log.steps[0].id).toBe("c5");
  });
  it("hands the main agent the report and the steps; the thread shows the report alone", () => {
    const log = new ActivityLog();
    log.start("c1", "WebSearch", { queries: ["btc etf flows"] });
    log.finish("c1", true);
    log.start("c2", "WebFetch", { url: "https://example.com" });
    log.finish("c2", false);
    expect(traceOf(log.steps)).toBe("✓ WebSearch — btc etf flows\n✗ WebFetch — https://example.com");
    const body = withTrace("The ETF saw inflows.", log.steps);
    expect(body).toContain("<subagent_steps>");
    expect(stripTrace(body)).toBe("The ETF saw inflows.");
    expect(withTrace("Nothing.", [])).toBe("Nothing.");
    const output = reportSection({ title: "ETF flows", profession: "analyste", prompt: "x" } as Parameters<typeof reportSection>[0], body);
    expect(parseWorkflowReport(output)[0].body).toBe("The ETF saw inflows.");
  });
});
