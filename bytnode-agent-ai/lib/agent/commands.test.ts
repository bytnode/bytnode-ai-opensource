import { describe, expect, it } from "vitest";
import { COMMANDS, completeCommand, isCommandText, matchCommands, runCommand, type SlashCommand } from "./commands";

const liste: SlashCommand[] = [
  { name: "compact", args: "[consignes]", description: "résumer" },
  { name: "clear", description: "effacer" },
  { name: "help", description: "aide" },
];

describe("matchCommands", () => {
  it("propose tout sur la barre seule", () => {
    expect(matchCommands("/", liste).map((c) => c.name)).toEqual(["compact", "clear", "help"]);
  });

  it("filtre sur le debut du nom, sans tenir compte de la casse", () => {
    expect(matchCommands("/c", liste).map((c) => c.name)).toEqual(["compact", "clear"]);
    expect(matchCommands("/CO", liste).map((c) => c.name)).toEqual(["compact"]);
    expect(matchCommands("/compact", liste).map((c) => c.name)).toEqual(["compact"]);
  });

  it("ne propose rien hors d'une commande en cours de frappe", () => {
    expect(matchCommands("", liste)).toEqual([]);
    expect(matchCommands("bonjour", liste)).toEqual([]);
    expect(matchCommands(" /c", liste)).toEqual([]);
    expect(matchCommands("/x", liste)).toEqual([]);
    /* Une espace apres le nom : la commande est complete, on tape ses consignes. */
    expect(matchCommands("/compact ", liste)).toEqual([]);
    expect(matchCommands("/compact garde les prix", liste)).toEqual([]);
    expect(matchCommands("/c\n", liste)).toEqual([]);
  });

  it("connait /compact par defaut", () => {
    expect(matchCommands("/comp").map((c) => c.name)).toEqual(["compact"]);
    expect(COMMANDS.every((c) => c.name && c.description)).toBe(true);
  });
});

describe("isCommandText", () => {
  it("reconnait une commande connue, avec ou sans consignes, pas un message", () => {
    for (const t of ["/compact", "  /compact ", "/compact garde les prix", "/COMPACT"]) expect(isCommandText(t)).toBe(true);
    for (const t of ["", "bonjour", "/c", "/compacter", "/x", "un /compact au milieu"]) expect(isCommandText(t)).toBe(false);
  });
});

describe("completeCommand / runCommand", () => {
  it("complete avec une espace, lance sans", () => {
    expect(completeCommand(liste[0])).toBe("/compact ");
    expect(runCommand(liste[0])).toBe("/compact");
  });
});
