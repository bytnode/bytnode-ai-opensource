import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadProfession } from "./load";
import { PROFESSIONS } from "./catalog";

const root = path.resolve(__dirname, "..", "..");

describe("loadProfession", () => {
  test("every profession has a prompt and its own skills plus the shared ones", async () => {
    for (const p of PROFESSIONS) {
      const prof = await loadProfession(root, p.id);
      expect(prof.prompt.length, p.id).toBeGreaterThan(400);
      expect(prof.prompt.startsWith("## Profession"), p.id).toBe(true);
      const names = prof.skills.map((s) => s.name);
      expect(names, p.id).toContain("source-bytnode");
      expect(names, p.id).toContain("reponse-financiere");
      expect(prof.skills.every((s) => s.description.length > 20), p.id).toBe(true);
    }
  });

  test("professions do not share their own skills", async () => {
    const a = (await loadProfession(root, "analyste")).skills.map((s) => s.name);
    const q = (await loadProfession(root, "quantitatif")).skills.map((s) => s.name);
    expect(a).toContain("analyse-tendance");
    expect(q).not.toContain("analyse-tendance");
    expect(q).toContain("backtest-python");
    expect(a).not.toContain("backtest-python");
  });

  test("an unknown folder yields an empty prompt, not an error", async () => {
    const prof = await loadProfession(path.join(root, "nope"), "standard");
    expect(prof.prompt).toBe("");
    expect(prof.skills).toEqual([]);
  });
});
