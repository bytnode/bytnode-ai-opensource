import { describe, expect, it } from "vitest";
import { AGENT_SOURCES, installPackageJson, satisfiesCaret } from "./packages";

describe("installPackageJson", () => {
  it("epingle le paquet et reprend les overrides", () => {
    const src = AGENT_SOURCES.claude;
    if (src.kind !== "npm") throw new Error("claude est un paquet npm");
    expect(installPackageJson(src)).toEqual({
      private: true,
      dependencies: { "@zed-industries/claude-agent-acp": src.version },
      overrides: { "@anthropic-ai/claude-agent-sdk": "^0.3.270" },
    });
  });
  it("n'ecrit pas d'overrides vides", () => {
    const src = AGENT_SOURCES.gemini;
    if (src.kind !== "npm") throw new Error("gemini est un paquet npm");
    expect(installPackageJson(src)).toEqual({ private: true, dependencies: { "@google/gemini-cli": src.version } });
  });
});

describe("satisfiesCaret", () => {
  it("accepte la meme majeure au-dessus du minimum", () => {
    expect(satisfiesCaret("1.12.0", "^1.11.0")).toBe(true);
    expect(satisfiesCaret("1.11.0", "^1.11.0")).toBe(true);
  });
  it("refuse une version plus basse ou une autre majeure", () => {
    expect(satisfiesCaret("1.10.9", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("2.0.0", "^1.11.0")).toBe(false);
  });
  it("en 0.x, la mineure doit etre la meme", () => {
    expect(satisfiesCaret("0.59.3", "^0.59.0")).toBe(true);
    expect(satisfiesCaret("0.60.0", "^0.59.0")).toBe(false);
  });
  it("tolere un suffixe de preversion sur l'installe", () => {
    expect(satisfiesCaret("1.11.0-beta.1", "^1.11.0")).toBe(false);
    expect(satisfiesCaret("1.12.0-beta.1", "^1.11.0")).toBe(true);
  });
});
