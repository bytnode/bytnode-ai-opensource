import { describe, expect, it } from "vitest";
import { RepetitionGuard, backoffDelay, isTransient } from "./resilience";
import { LlmError } from "@/lib/llm/client";

describe("isTransient", () => {
  it("relance sur surcharge, erreur serveur et delai", () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504, 522, 529]) {
      expect(isTransient(new LlmError("x", s)), String(s)).toBe(true);
    }
  });

  it("ne relance pas sur une erreur de la requete", () => {
    for (const s of [400, 401, 402, 403, 404, 422]) {
      expect(isTransient(new LlmError("x", s)), String(s)).toBe(false);
    }
  });

  it("relance sur une coupure reseau", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(new Error("socket hang up"))).toBe(true);
    expect(isTransient(new Error("ECONNRESET"))).toBe(true);
    expect(isTransient(new Error("terminated"))).toBe(true);
  });

  it("ne relance jamais une interruption voulue", () => {
    const abort = new DOMException("Interrompu", "AbortError");
    expect(isTransient(abort)).toBe(false);
  });

  it("ne relance pas une erreur qu'on ne reconnait pas", () => {
    expect(isTransient(new Error("le modèle a refusé"))).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("croit et reste borne", () => {
    expect(backoffDelay(0)).toBeLessThanOrEqual(1200);
    expect(backoffDelay(1)).toBeGreaterThan(backoffDelay(0) / 2);
    expect(backoffDelay(9)).toBeLessThanOrEqual(8000);
  });
});

describe("RepetitionGuard", () => {
  const appel = (name: string, args: Record<string, unknown>) => ({ name, args });

  it("laisse passer des appels differents", () => {
    const g = new RepetitionGuard();
    expect(g.check(appel("Read", { file_path: "a" }))).toBeNull();
    expect(g.check(appel("Read", { file_path: "b" }))).toBeNull();
    expect(g.check(appel("Bash", { command: "ls" }))).toBeNull();
  });

  it("coupe au troisieme appel identique", () => {
    const g = new RepetitionGuard();
    const a = appel("Bash", { command: "python x.py" });
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).toBeNull();
    const stop = g.check(a);
    expect(stop).toContain("3 fois");
    expect(stop).toContain("python x.py");
  });

  it("ne tient pas compte de l'ordre des arguments", () => {
    const g = new RepetitionGuard();
    g.check(appel("Edit", { file_path: "a", old: "x" }));
    g.check(appel("Edit", { old: "x", file_path: "a" }));
    expect(g.check(appel("Edit", { file_path: "a", old: "x" }))).not.toBeNull();
  });

  it("un appel qui reussit remet son compteur a zero", () => {
    const g = new RepetitionGuard();
    const a = appel("Bash", { command: "ls" });
    g.check(a);
    g.check(a);
    g.succeeded(a);
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).toBeNull();
    expect(g.check(a)).not.toBeNull();
  });

  it("compte separement deux appels distincts", () => {
    const g = new RepetitionGuard();
    const a = appel("Bash", { command: "a" });
    const b = appel("Bash", { command: "b" });
    g.check(a);
    g.check(b);
    g.check(a);
    g.check(b);
    expect(g.check(a)).not.toBeNull();
    expect(g.check(b)).not.toBeNull();
  });
});
