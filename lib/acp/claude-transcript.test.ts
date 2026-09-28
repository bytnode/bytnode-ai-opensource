import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeLocalOutputs, goalVerdictIn, localOutputsIn, projectSlug, settingsChanged, withTerminalLines } from "./claude-transcript";

/* Entries as Claude Code 2.1 writes them in `<session>.jsonl`. */
const entry = (at: string, content: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "system", subtype: "local_command", content, level: "info", timestamp: at, sessionId: "s1", ...extra });
const T0 = Date.parse("2026-09-28T16:39:10.000Z");

describe("localOutputsIn", () => {
  it("reads the answers of the commands run since the turn began, in order", () => {
    const jsonl = [
      entry("2026-09-28T16:39:09.000Z", "<local-command-stdout>an older command</local-command-stdout>"),
      JSON.stringify({ type: "user", message: { role: "user", content: "<command-name>/model</command-name>" }, timestamp: "2026-09-28T16:39:10.100Z" }),
      entry("2026-09-28T16:39:10.397Z", "<local-command-stdout>Set model to `Haiku 4.5` for this session only</local-command-stdout>"),
      entry("2026-09-28T16:39:10.500Z", "<local-command-stderr>Unknown setting: foo</local-command-stderr>"),
      entry("2026-09-28T16:39:10.600Z", "<local-command-stdout>  </local-command-stdout>"),
      '{"type":"system","subtype":"local_command","content":"<local-command-stdout>cut by the tail re',
    ].join("\n");
    expect(localOutputsIn(jsonl, T0)).toEqual(["Set model to `Haiku 4.5` for this session only", "Unknown setting: foo"]);
  });

  it("keeps a multi-line answer whole (/usage)", () => {
    const usage = "You are currently using your subscription\n\nCurrent session: 29% used";
    expect(localOutputsIn(entry("2026-09-28T16:39:11.000Z", `<local-command-stdout>${usage}</local-command-stdout>`), T0)).toEqual([usage]);
  });
});

describe("settingsChanged", () => {
  const models = [
    { value: "default", name: "Default (recommended)" },
    { value: "opus", name: "Opus 5.5" },
    { value: "haiku", name: "Haiku 4.5" },
  ];

  it("turns /model and /effort answers into the session's new settings", () => {
    expect(settingsChanged(["Set model to `Haiku 4.5` for this session only", "Set effort level to low (this session only): Quick"], models)).toEqual({ model: "haiku", effort: "low" });
    expect(settingsChanged(["Set model to `opus`"], models)).toEqual({ model: "opus" });
  });

  it("reads nothing into other answers, nor a model it cannot name", () => {
    expect(settingsChanged(["Current model: `Opus 5.5 (default)`\nUsage: /model <name>"], models)).toEqual({});
    expect(settingsChanged(["Set model to `Mystery 9`"], models)).toEqual({});
  });
});

describe("claudeLocalOutputs", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });

  it("finds the session's folder from the cwd, and reads the new file /clear starts", async () => {
    const config = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
    process.env.CLAUDE_CONFIG_DIR = config;
    const cwd = path.join(os.tmpdir(), "bytnode-ai", "workspaces", "_acp");
    expect(projectSlug("C:\\Users\\fremo\\.bytnode-ai\\workspaces\\_acp")).toBe("C--Users-fremo--bytnode-ai-workspaces--acp");
    const dir = path.join(config, "projects", projectSlug(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const since = Date.now() - 1000;
    const at = new Date(since + 500).toISOString();
    fs.writeFileSync(path.join(dir, "s1.jsonl"), `${entry(at, "<local-command-stdout>Session renamed to: probe</local-command-stdout>")}\n`);
    fs.writeFileSync(path.join(dir, "after-clear.jsonl"), `${entry(at, "<local-command-stdout>Session color set to: green</local-command-stdout>")}\n`);
    const out = await claudeLocalOutputs(cwd, "s1", since);
    expect(out.sort()).toEqual(["Session color set to: green", "Session renamed to: probe"]);
  });

  it("nothing when Claude Code wrote nothing", async () => {
    process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
    expect(await claudeLocalOutputs(path.join(os.tmpdir(), "nowhere"), "s9", Date.now())).toEqual([]);
  });
});

describe("withTerminalLines", () => {
  it("keeps the terminal's lines, not tables nor code", () => {
    expect(withTerminalLines("Current session: 6% used\nCurrent week: 23% used\n\nLast 24h · 949 requests\n  87% subagents")).toBe(
      "Current session: 6% used  \nCurrent week: 23% used\n\nLast 24h · 949 requests  \n  87% subagents",
    );
    const table = "| Category | Tokens |\n|---|---|\n| Skills | 2k |";
    expect(withTerminalLines(`## Context\n\n${table}`)).toBe(`## Context\n\n${table}`);
    expect(withTerminalLines("Set model to `Haiku 4.5` for this session only")).toBe("Set model to `Haiku 4.5` for this session only");
  });
});

describe("goalVerdictIn", () => {
  const goal = (at: string, attachment: Record<string, unknown>) => JSON.stringify({ type: "attachment", attachment: { type: "goal_status", ...attachment }, timestamp: at });
  it("the last verdict, not the sentinel that only marks the goal active", () => {
    const jsonl = [
      goal("2026-09-28T16:39:10.100Z", { met: false, sentinel: true, condition: "say kiwi" }),
      goal("2026-09-28T16:39:11.000Z", { met: false, condition: "say kiwi", reason: "not said yet" }),
      goal("2026-09-28T16:39:12.000Z", { met: true, condition: "say kiwi", reason: "the last message is kiwi" }),
    ];
    expect(goalVerdictIn(jsonl.join("\n"), T0)).toBe("**Goal met** — the last message is kiwi");
    expect(goalVerdictIn(jsonl.slice(0, 2).join("\n"), T0)).toBe("**Goal not met yet** — not said yet");
    expect(goalVerdictIn(jsonl[0], T0)).toBeNull();
    expect(goalVerdictIn(jsonl.join("\n"), Date.parse("2026-09-28T16:40:00.000Z"))).toBeNull();
  });
});
