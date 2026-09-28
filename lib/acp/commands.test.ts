import { describe, expect, it } from "vitest";
import { agentCommands, isAgentCommandText } from "./commands";

/* The lists as the three agents really publish them (probed 2026-09-28:
   Claude Code 2.1 via claude-agent-acp, codex-acp 1.13, Gemini CLI 0.56). */
describe("agentCommands", () => {
  it("keeps names, hints and descriptions; drops the agent's internal plumbing", () => {
    const list = agentCommands(
      [
        { name: "goal", description: "Set a goal — keep working until the condition is met", input: null },
        { name: "code-review", description: "Review the current diff", input: { hint: "[low|medium|high] [--fix]" } },
        { name: "__remote-workflow", description: "internal", input: null },
        { name: "memory show", description: "Shows the current memory contents." },
      ],
      "Claude Code",
    );
    expect(list).toEqual([
      { name: "goal", description: "Set a goal — keep working until the condition is met", source: "Claude Code" },
      { name: "code-review", description: "Review the current diff", args: "[low|medium|high] [--fix]", source: "Claude Code" },
      { name: "memory show", description: "Shows the current memory contents.", source: "Claude Code" },
    ]);
  });

  it("a Codex skill keeps `$` as its trigger; duplicates are dropped", () => {
    expect(
      agentCommands([
        { name: "$pdf:pdf", description: "PDF", input: null },
        { name: "status", description: "Status", input: null },
        { name: "status", description: "again", input: null },
      ]),
    ).toEqual([
      { name: "pdf:pdf", description: "PDF", trigger: "$" },
      { name: "status", description: "Status" },
    ]);
  });
});

describe("isAgentCommandText", () => {
  const known = agentCommands([
    { name: "goal", description: "", input: { hint: "[<objective>|clear]" } },
    { name: "memory show", description: "" },
    { name: "$imagegen", description: "" },
  ]);

  it("a published command, with or without arguments", () => {
    expect(isAgentCommandText("/goal ship the report", known)).toBe(true);
    expect(isAgentCommandText("  /GOAL", known)).toBe(true);
    expect(isAgentCommandText("/memory show", known)).toBe(true);
  });

  it("not a message that merely starts with a slash, nor a $skill", () => {
    expect(isAgentCommandText("/api/v3 returns 500", known)).toBe(false);
    expect(isAgentCommandText("/unknown", known)).toBe(false);
    expect(isAgentCommandText("$imagegen a cat", known)).toBe(false);
    expect(isAgentCommandText("hello /goal", known)).toBe(false);
  });

  it("before any list is known, a /word counts", () => {
    expect(isAgentCommandText("/status", null)).toBe(true);
    expect(isAgentCommandText("/review-branch main", [])).toBe(true);
    expect(isAgentCommandText("/", null)).toBe(false);
    expect(isAgentCommandText("/api/v3 returns 500", null)).toBe(false);
    expect(isAgentCommandText("/ 2", null)).toBe(false);
  });
});
