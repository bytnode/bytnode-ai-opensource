import { describe, expect, it } from "vitest";
import { COMMANDS, commandOf, completeCommand, groupBySource, isCommandText, matchCommands, mergeCommands, runCommand, type SlashCommand } from "./commands";

const liste: SlashCommand[] = [
  { name: "compact", args: "[instructions]", description: "summarise" },
  { name: "clear", description: "clear" },
  { name: "help", description: "help" },
];

describe("matchCommands", () => {
  it("proposes everything on the slash alone", () => {
    expect(matchCommands("/", liste).map((c) => c.name)).toEqual(["compact", "clear", "help"]);
  });

  it("filters on the start of the name, ignoring case", () => {
    expect(matchCommands("/c", liste).map((c) => c.name)).toEqual(["compact", "clear"]);
    expect(matchCommands("/CO", liste).map((c) => c.name)).toEqual(["compact"]);
    expect(matchCommands("/compact", liste).map((c) => c.name)).toEqual(["compact"]);
  });

  it("proposes nothing outside a command being typed", () => {
    expect(matchCommands("", liste)).toEqual([]);
    expect(matchCommands("bonjour", liste)).toEqual([]);
    expect(matchCommands(" /c", liste)).toEqual([]);
    expect(matchCommands("/x", liste)).toEqual([]);
    /* A space after the name: the command is complete, its instructions are being typed. */
    expect(matchCommands("/compact ", liste)).toEqual([]);
    expect(matchCommands("/compact keep the prices", liste)).toEqual([]);
    expect(matchCommands("/c\n", liste)).toEqual([]);
  });

  it("knows /compact by default", () => {
    expect(matchCommands("/comp").map((c) => c.name)).toEqual(["compact"]);
    expect(COMMANDS.every((c) => c.name && c.description)).toBe(true);
  });
});

describe("isCommandText", () => {
  it("recognises a known command, with or without instructions, not a message", () => {
    for (const t of ["/compact", "  /compact ", "/compact keep the prices", "/COMPACT"]) expect(isCommandText(t)).toBe(true);
    for (const t of ["", "bonjour", "/c", "/compacter", "/x", "a /compact in the middle"]) expect(isCommandText(t)).toBe(false);
  });
});

describe("completeCommand / runCommand", () => {
  it("completes with a space, runs without", () => {
    expect(completeCommand(liste[0])).toBe("/compact ");
    expect(runCommand(liste[0])).toBe("/compact");
  });
});

/* The subscription agents' own lists: sub-commands carry a space, Codex's skills start with `$`, Claude Code publishes fifty. */
describe("an agent's own commands", () => {
  const agent: SlashCommand[] = [
    { name: "memory", description: "memory" },
    { name: "memory show", description: "show" },
    { name: "memory list", description: "list" },
    { name: "code-review", args: "[low|high]", description: "review" },
    { name: "compact", description: "the agent's own compact", source: "Codex" },
    { name: "pdf:pdf", description: "PDF skill", trigger: "$" },
  ];

  it("a space keeps the list open while a longer name still matches (sub-commands)", () => {
    expect(matchCommands("/memory ", agent).map((c) => c.name)).toEqual(["memory show", "memory list"]);
    expect(matchCommands("/memory s", agent).map((c) => c.name)).toEqual(["memory show"]);
    expect(matchCommands("/memory show ", agent)).toEqual([]);
    expect(matchCommands("/code-review high", agent)).toEqual([]);
  });

  it("from two characters, names containing the text follow those starting with it", () => {
    expect(matchCommands("/review", agent).map((c) => c.name)).toEqual(["code-review"]);
    expect(matchCommands("/m", agent).map((c) => c.name)).toEqual(["memory", "memory show", "memory list"]);
  });

  it("a $ lists the skills, a / never does", () => {
    expect(matchCommands("$", agent).map((c) => c.name)).toEqual(["pdf:pdf"]);
    expect(matchCommands("/pd", agent)).toEqual([]);
    expect(runCommand(agent[5])).toBe("$pdf:pdf");
    expect(completeCommand(agent[5])).toBe("$pdf:pdf ");
  });

  it("commandOf finds the longest name and what follows", () => {
    expect(commandOf("/memory show all", agent)).toMatchObject({ command: { name: "memory show" }, rest: "all" });
    expect(commandOf("/memory", agent)).toMatchObject({ command: { name: "memory" }, rest: "" });
    expect(commandOf("/code-review high --fix", agent)).toMatchObject({ command: { name: "code-review" }, rest: "high --fix" });
    expect(commandOf("$pdf:pdf read it", agent)).toMatchObject({ command: { name: "pdf:pdf", trigger: "$" } });
    expect(commandOf("/goal", agent)).toBeNull();
    expect(commandOf("hello /memory", agent)).toBeNull();
  });

  it("groupBySource: one caption per source, in the order of the matches; the keyboard walks the shown order", () => {
    const list: SlashCommand[] = [
      { name: "compact", description: "" },
      { name: "goal", description: "", source: "Claude Code" },
      { name: "status", description: "", source: "Codex" },
      { name: "usage", description: "", source: "Claude Code" },
    ];
    const { groups, flat } = groupBySource(list);
    expect(groups.map((g) => [g.source, g.items.map((c) => c.name)])).toEqual([
      ["BytNode-AI", ["compact"]],
      ["Claude Code", ["goal", "usage"]],
      ["Codex", ["status"]],
    ]);
    expect(flat.map((c) => c.name)).toEqual(["compact", "goal", "usage", "status"]);
  });

  it("mergeCommands: ours first, the agent's same name wins", () => {
    expect(mergeCommands(agent).filter((c) => c.name === "compact")).toEqual([agent[4]]);
    expect(mergeCommands([{ name: "goal", description: "g" }]).map((c) => c.name)).toEqual(["compact", "goal"]);
  });
});
