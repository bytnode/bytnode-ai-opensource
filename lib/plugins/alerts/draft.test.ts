import { describe, expect, it } from "vitest";
import { describeCondition } from "./conditions";
import { BLANK_DRAFT, buildCondition, defaultMetric, draftCondition, type Draft } from "./draft";

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

  it("reads well in words; the blank draft waits for its level", () => {
    const say = (d: Draft) => {
      const c = draftCondition(d);
      if ("error" in c) throw new Error(c.error);
      return describeCondition(c);
    };
    expect(say({ subject: { kind: "metric", metric: { kind: "ema", length: 50, tf: "1d" } }, op: "crosses_above", against: { kind: "metric", metric: { kind: "ema", length: 200, tf: "1d" } } })).toBe("EMA 50 · 1D crosses above EMA 200 · 1D");
    expect(say({ subject: { kind: "metric", metric: { kind: "price" } }, op: "crosses_above", against: { kind: "metric", metric: { kind: "bb", length: 20, mult: 2, tf: "1h", band: "upper" } } })).toBe("Price crosses above Bollinger upper 20,2 · 1H");
    expect(say({ subject: { kind: "position", field: "liq" }, op: "<", against: { kind: "value", value: "5" } })).toBe("Liquidation < 5 % away");
    expect(buildCondition(BLANK_DRAFT)).toEqual({ error: "Enter a number." });
    expect(buildCondition({ ...BLANK_DRAFT, against: { kind: "value", value: "120000" } })).toBe("price>120000");
  });
});
