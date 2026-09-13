import { describe, expect, test } from "vitest";
import { validateArgs } from "./validate";
import type { JsonSchema } from "./types";

/* Un appel mal forme doit revenir au modele en une phrase qu'il peut
   corriger, sans executer l'outil ni deranger l'utilisateur. */

const schema: JsonSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "Le fichier." },
    limit: { type: "integer", minimum: 1, maximum: 500 },
    ratio: { type: "number" },
    dry: { type: "boolean" },
    action: { type: "string", enum: ["add", "search", "list"] },
    tags: { type: "array", items: { type: "string" } },
    slug: { type: "string", pattern: "^[a-z-]+$" },
  },
  required: ["path"],
  additionalProperties: false,
};

describe("validateArgs", () => {
  test("accepte des arguments conformes", () => {
    expect(validateArgs(schema, { path: "a.md", limit: 10, ratio: 0.5, dry: true, action: "add", tags: ["x"], slug: "ok-slug" })).toBeNull();
  });

  test("signale un argument requis manquant, avec son type", () => {
    expect(validateArgs(schema, {})).toBe("`path` requis (string).");
  });

  test("signale un type incorrect en montrant la valeur reçue", () => {
    expect(validateArgs(schema, { path: 12 })).toBe("`path` : string attendu, reçu 12.");
    expect(validateArgs(schema, { path: "a", limit: "abc" })).toBe("`limit` : integer attendu, reçu \"abc\".");
    expect(validateArgs(schema, { path: "a", limit: 1.5 })).toBe("`limit` : integer attendu, reçu 1.5.");
    expect(validateArgs(schema, { path: "a", dry: "oui" })).toBe("`dry` : boolean attendu, reçu \"oui\".");
    expect(validateArgs(schema, { path: "a", tags: "x" })).toBe("`tags` : array attendu, reçu \"x\".");
  });

  test("verifie les elements d'un tableau", () => {
    expect(validateArgs(schema, { path: "a", tags: ["x", 3] })).toBe("`tags[1]` : string attendu, reçu 3.");
  });

  test("verifie une liste de valeurs, les bornes et un motif", () => {
    expect(validateArgs(schema, { path: "a", action: "drop" })).toBe("`action` : valeur hors liste (add, search, list), reçu \"drop\".");
    expect(validateArgs(schema, { path: "a", limit: 0 })).toBe("`limit` : au moins 1, reçu 0.");
    expect(validateArgs(schema, { path: "a", limit: 900 })).toBe("`limit` : au plus 500, reçu 900.");
    expect(validateArgs(schema, { path: "a", slug: "Nope!" })).toBe("`slug` : ne respecte pas le motif ^[a-z-]+$, reçu \"Nope!\".");
  });

  test("refuse un argument inconnu quand le schema ferme la porte", () => {
    expect(validateArgs(schema, { path: "a", extra: 1 })).toBe("`extra` : argument inconnu (attendus : path, limit, ratio, dry, action, tags, slug).");
  });

  test("tolere un argument inconnu quand le schema ne dit rien", () => {
    expect(validateArgs({ type: "object", properties: { a: { type: "string" } } }, { a: "x", b: 1 })).toBeNull();
  });

  test("un argument optionnel absent ou nul passe", () => {
    expect(validateArgs(schema, { path: "a", limit: undefined, dry: null })).toBeNull();
  });

  test("ne signale que le premier probleme, dans l'ordre du schema", () => {
    expect(validateArgs(schema, { limit: "x" })).toBe("`path` requis (string).");
  });
});
