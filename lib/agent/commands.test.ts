import { describe, expect, it } from "vitest";
import { COMMANDS, completeCommand, isCommandText, matchCommands, runCommand, type SlashCommand } from "./commands";

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
