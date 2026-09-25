import { describe, expect, it } from "vitest";
import { AGENT_SOURCES, highestInCaret, installPackageJson, isNewer, satisfiesCaret, trackedPackages } from "./packages";

describe("installPackageJson", () => {
  it("pins the package and copies the overrides", () => {
    const src = AGENT_SOURCES.claude;
    if (src.kind !== "npm") throw new Error("claude is an npm package");
    expect(installPackageJson(src)).toEqual({
      private: true,
      dependencies: { "@zed-industries/claude-agent-acp": src.version },
      overrides: { "@anthropic-ai/claude-agent-sdk": "^0.3.270" },
    });
  });
  it("does not write empty overrides", () => {
    const src = AGENT_SOURCES.gemini;
    if (src.kind !== "npm") throw new Error("gemini is an npm package");
    expect(installPackageJson(src)).toEqual({ private: true, dependencies: { "@google/gemini-cli": src.version } });
  });
  it("an update pins the exact versions it found, the rest keeps its range", () => {
    const src = AGENT_SOURCES.claude;
    if (src.kind !== "npm") throw new Error("claude is an npm package");
    expect(installPackageJson(src, { "@anthropic-ai/claude-agent-sdk": "0.3.282" })).toEqual({
      private: true,
      dependencies: { "@zed-industries/claude-agent-acp": src.version },
      overrides: { "@anthropic-ai/claude-agent-sdk": "0.3.282" },
    });
  });
});

describe("trackedPackages", () => {
  it("lists the agent's package, then its overrides", () => {
    const src = AGENT_SOURCES.claude;
    if (src.kind !== "npm") throw new Error("claude is an npm package");
    expect(trackedPackages(src)).toEqual([
      ["@zed-industries/claude-agent-acp", src.version],
      ["@anthropic-ai/claude-agent-sdk", "^0.3.270"],
    ]);
  });
});

describe("highestInCaret / isNewer", () => {
  const versions = ["0.3.270", "0.3.278", "0.3.282", "0.3.283-beta.1", "0.4.0", "0.2.99", "junk"];
  it("takes the latest release in the range, never a pre-release or the next 0.x minor", () => {
    expect(highestInCaret(versions, "^0.3.270")).toBe("0.3.282");
    expect(highestInCaret(versions, "^0.5.0")).toBeNull();
  });
  it("compares x.y.z numerically", () => {
    expect(isNewer("0.3.282", "0.3.278")).toBe(true);
    expect(isNewer("0.3.100", "0.3.99")).toBe(true);
    expect(isNewer("0.3.278", "0.3.278")).toBe(false);
    expect(isNewer("1.0.0", "junk")).toBe(false);
  });
});

describe("satisfiesCaret", () => {
  it("accepts the same major above the minimum", () => {
    expect(satisfiesCaret("1.12.0", "^1.11.0")).toBe(true);
    expect(satisfiesCaret("1.11.0", "^1.11.0")).toBe(true);
  });
  it("refuses a lower version or another major", () => {
    expect(satisfiesCaret("1.10.9", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("2.0.0", "^1.11.0")).toBe(false);
  });
  it("in 0.x, the minor must be the same", () => {
    expect(satisfiesCaret("0.59.3", "^0.59.0")).toBe(true);
    expect(satisfiesCaret("0.60.0", "^0.59.0")).toBe(false);
  });
  it("tolerates a pre-release suffix on the installed version", () => {
    expect(satisfiesCaret("1.11.0-beta.1", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("1.12.0-beta.1", "^1.11.0")).toBe(true);
  });
});
