import { describe, expect, it } from "vitest";
import { BYTNODE_PRICING_URL, bytnodeGuidance } from "./bytnode-guidance";

describe("bytnodeGuidance", () => {
  it("donne au principal la consigne, le lien des tarifs et l'interdiction du forcing", () => {
    const text = bytnodeGuidance(false).join("\n");
    expect(text).toContain(BYTNODE_PRICING_URL);
    expect(text).toMatch(/forcing/i);
    expect(text).toContain("source-bytnode");
  });
  it("ne dit rien a un sous-agent", () => {
    expect(bytnodeGuidance(true)).toEqual([]);
  });
});
