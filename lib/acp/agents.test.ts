import { describe, expect, it } from "vitest";
import { acpAgentOf, isRetiredAcpModel } from "./agents";

describe("a removed subscription (Gemini CLI, 2026-10-09)", () => {
  it("is no longer an agent", () => {
    expect(acpAgentOf("acp:gemini")).toBeNull();
    expect(acpAgentOf("acp:claude")?.id).toBe("claude");
  });

  it("its old conversations' models are recognised, the others' are not", () => {
    expect(isRetiredAcpModel("acp:gemini/auto")).toBe(true);
    expect(isRetiredAcpModel("acp:claude/opus")).toBe(false);
    expect(isRetiredAcpModel("acp:grok/grok-5")).toBe(false);
    expect(isRetiredAcpModel("google/gemini-3.5-flash-lite")).toBe(false);
    expect(isRetiredAcpModel(null)).toBe(false);
  });
});
