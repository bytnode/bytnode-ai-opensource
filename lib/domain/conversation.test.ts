import { describe, expect, test } from "vitest";
import { deriveTitle, newId } from "./conversation";

describe("deriveTitle", () => {
  test("uses the first line of the message, trimmed", () => {
    expect(deriveTitle("  Bonjour toi\nsuite")).toBe("Bonjour toi");
  });

  test("cuts long titles on a word boundary with an ellipsis", () => {
    const t = deriveTitle("Explique-moi comment fonctionne la mémoire cache d'un processeur moderne s'il te plaît");
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/\s…$/);
  });

  test("falls back to a default for an empty message", () => {
    expect(deriveTitle("   ")).toBe("New conversation");
  });
});

describe("newId", () => {
  test("produces distinct ids", () => {
    expect(newId()).not.toBe(newId());
  });
});
