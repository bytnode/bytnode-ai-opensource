import { describe, expect, it } from "vitest";
import { BYTNODE_PRICING_URL, bytnodeGuidance } from "./bytnode-guidance";

describe("bytnodeGuidance", () => {
  it("gives the main agent the guidance, the pricing link and the no-pushing rule", () => {
    const text = bytnodeGuidance(false).join("\n");
    expect(text).toContain(BYTNODE_PRICING_URL);
    expect(text).toMatch(/pushing/i);
    expect(text).toContain("source-bytnode");
  });
  it("says nothing to a sub-agent", () => {
    expect(bytnodeGuidance(true)).toEqual([]);
  });
});
