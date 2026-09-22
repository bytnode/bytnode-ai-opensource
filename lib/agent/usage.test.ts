import { describe, expect, it } from "vitest";
import { PROMPT_OVERHEAD, contextEstimate, estimateTokens, fmtCost, fmtTokens, mergeUsage, rate, usageState } from "./usage";

describe("estimateTokens", () => {
  it("estimates from the characters, French included", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBeGreaterThan(80);
    expect(estimateTokens("a".repeat(400))).toBeLessThan(140);
  });
});

describe("mergeUsage", () => {
  it("keeps the last known count, field by field", () => {
    const a = mergeUsage(undefined, { input: 100, provider: "Modal" });
    expect(a).toEqual({ input: 100, provider: "Modal" });
    expect(mergeUsage(a, { output: 20 })).toEqual({ input: 100, output: 20, provider: "Modal" });
  });

  it("adds up the costs of several turns", () => {
    const a = mergeUsage(undefined, { cost: 0.01 });
    expect(mergeUsage(a, { cost: 0.02 }, { addCost: true })?.cost).toBeCloseTo(0.03);
    expect(mergeUsage(a, { cost: 0.02 })?.cost).toBeCloseTo(0.02);
  });
});

describe("usageState", () => {
  it("derives the context from input and output tokens", () => {
    const s = usageState({ input: 8_000, output: 2_000 }, 200_000);
    expect(s.context).toBe(10_000);
    expect(s.window).toBe(200_000);
    expect(s.part).toBeCloseTo(0.05);
    expect(s.level).toBe("ok");
  });

  it("prefers the context the agent announces itself", () => {
    const s = usageState({ context: 33_502, window: 1_000_000, input: 5 }, 200_000);
    expect(s.context).toBe(33_502);
    expect(s.window).toBe(1_000_000);
  });

  it("warns then alerts as the window fills up", () => {
    expect(usageState({ context: 150_000 }, 200_000).level).toBe("warn");
    expect(usageState({ context: 185_000 }, 200_000).level).toBe("full");
  });

  it("without a known window, no share", () => {
    const s = usageState({ context: 1_000 }, null);
    expect(s.window).toBeNull();
    expect(s.part).toBeNull();
    expect(s.level).toBe("ok");
  });
});

describe("contextEstimate", () => {
  it("starts from the skeleton and adds the thread", () => {
    expect(contextEstimate([])).toBe(PROMPT_OVERHEAD);
    expect(contextEstimate([{ content: "a".repeat(360) }])).toBe(PROMPT_OVERHEAD + 100);
  });
  it("counts the tool outputs replayed to the model, not the reasoning", () => {
    const steps = [
      { type: "tool" as const, id: "c", name: "Read", args: {}, status: "done" as const, output: "o".repeat(3600) },
      { type: "thought" as const, text: "t".repeat(3600) },
    ];
    /* The arguments (`{}`) and the output go back to the model; the reasoning does not. */
    expect(contextEstimate([{ content: "", steps }])).toBe(PROMPT_OVERHEAD + estimateTokens("{}" + "o".repeat(3600)));
  });
});

describe("usageState with an estimate", () => {
  it("shows the estimate as long as no exact count has arrived", () => {
    const s = usageState(undefined, 200_000, 12_000);
    expect(s.context).toBe(12_000);
    expect(s.estimated).toBe(true);
    expect(s.part).toBeCloseTo(0.06);
  });

  it("the exact count wins over the estimate", () => {
    const s = usageState({ input: 9_000, output: 500 }, 200_000, 12_000);
    expect(s.context).toBe(9_500);
    expect(s.estimated).toBe(false);
  });
});

describe("rate", () => {
  it("tokens per second, rounded", () => {
    expect(rate(300, 3000)).toBe(100);
    expect(rate(0, 3000)).toBe(0);
    expect(rate(300, 0)).toBeNull();
    expect(rate(300, 120)).toBeNull();
  });
});

describe("formatting", () => {
  it("tokens in k beyond a thousand", () => {
    expect(fmtTokens(940)).toBe("940");
    expect(fmtTokens(12_400)).toBe("12.4k");
    expect(fmtTokens(1_000_000)).toBe("1.0M");
  });

  it("the cost in dollars, never a misleading zero", () => {
    expect(fmtCost(0)).toBeNull();
    expect(fmtCost(0.2487)).toBe("$0.249");
    expect(fmtCost(0.00012)).toBe("< $0.001");
    expect(fmtCost(12.5)).toBe("$12.50");
  });
});
