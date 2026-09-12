import { describe, expect, it } from "vitest";
import { buildCompactRequest, compactionMessage, isCompactCommand, transcriptOf } from "./compact";
import type { Message } from "@/lib/domain/types";

const user = (content: string): Message => ({ id: content, role: "user", content, createdAt: 1 });
const agent = (content: string): Message => ({ id: content, role: "assistant", content, createdAt: 2 });

describe("isCompactCommand", () => {
  it("reconnait la commande, seule ou avec des consignes", () => {
    expect(isCompactCommand("/compact")).toEqual({ instructions: "" });
    expect(isCompactCommand("  /compact  ")).toEqual({ instructions: "" });
    expect(isCompactCommand("/compact garde les niveaux de prix")).toEqual({ instructions: "garde les niveaux de prix" });
    expect(isCompactCommand("/COMPACT")).toEqual({ instructions: "" });
  });

  it("ne se declenche pas sur du texte qui la mentionne", () => {
    expect(isCompactCommand("explique-moi /compact")).toBeNull();
    expect(isCompactCommand("compact")).toBeNull();
    expect(isCompactCommand("/compacter")).toBeNull();
    expect(isCompactCommand("")).toBeNull();
  });
});

describe("buildCompactRequest", () => {
  it("demande un resume structure", () => {
    const r = buildCompactRequest("");
    expect(r).toContain("résumé");
    expect(r).toMatch(/décisions|Décisions/);
  });

  it("ajoute les consignes de l'utilisateur quand il y en a", () => {
    expect(buildCompactRequest("garde les niveaux")).toContain("garde les niveaux");
    expect(buildCompactRequest("")).not.toContain("Consigne");
  });
});

describe("transcriptOf", () => {
  it("rend un fil lisible, roles nommes", () => {
    const t = transcriptOf([user("salut"), agent("bonjour")]);
    expect(t).toBe("Utilisateur : salut\n\nAgent : bonjour");
  });

  it("saute les messages vides et borne la longueur", () => {
    const long = [user("a".repeat(20_000)), agent("fin")];
    const t = transcriptOf(long, 500);
    expect(t.length).toBeLessThanOrEqual(520);
    expect(t.startsWith("[…]")).toBe(true);
    expect(t).toContain("fin");
    expect(transcriptOf([user(""), agent("seul")])).toBe("Agent : seul");
  });
});

describe("compactionMessage", () => {
  it("porte le marqueur et le resume", () => {
    const m = compactionMessage("résumé du fil", "m1", 42);
    expect(m).toMatchObject({ id: "m1", role: "assistant", content: "résumé du fil", compaction: true, createdAt: 42 });
    expect(m.steps).toEqual([{ type: "text", text: "résumé du fil" }]);
  });
});
