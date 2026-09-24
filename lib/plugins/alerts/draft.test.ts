import { describe, expect, it } from "vitest";
import { describeCondition } from "./conditions";
import { PRESETS, buildCondition, defaultMetric, draftCondition, type Draft } from "./draft";

describe("the form's draft", () => {
  it("builds the condition an agent would write", () => {
    const rsi: Draft = { subject: { kind: "metric", metric: defaultMetric("rsi", "4h") }, op: "crosses_below", against: { kind: "value", value: "30" } };
    expect(buildCondition(rsi)).toBe("rsi(14,4h) crosses_below 30");
    expect(buildCondition({ ...rsi, op: "<", against: { kind: "value", value: " 28,5 " } })).toBe("rsi(14,4h)<28.5");
    expect(buildCondition({ ...rsi, against: { kind: "value", value: "abc" } })).toEqual({ error: "Enter a number." });
    expect(buildCondition({ subject: { kind: "metric", metric: { kind: "price" } }, op: ">", against: { kind: "metric", metric: defaultMetric("ema", "1d") } })).toBe("price>ema(200,1d)");
    expect(buildCondition({ subject: { kind: "position", field: "pnlPct" }, op: "crosses_below", against: { kind: "value", value: "-2" } })).toBe("pnl%<-2");
    expect(buildCondition({ subject: { kind: "position", field: "closed" }, op: ">", against: { kind: "value", value: "" } })).toBe("closed");
    expect(buildCondition({ subject: { kind: "event", hours: 24 }, op: ">", against: { kind: "value", value: "" } })).toBe("event<24h");
  });

  it("every preset with a level makes a condition that reads well", () => {
    const labels = PRESETS.filter((p) => p.draft.against.kind === "metric" || p.draft.against.value !== "").map((p) => {
      const c = draftCondition(p.draft);
      if ("error" in c) throw new Error(`${p.id}: ${c.error}`);
      return describeCondition(c);
    });
    expect(labels).toContain("EMA 50 · 1D crosses above EMA 200 · 1D");
    expect(labels).toContain("Price crosses above Bollinger upper 20,2 · 1H");
    expect(labels).toContain("Liquidation < 5 % away");
  });
});
