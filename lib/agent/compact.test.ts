import { describe, expect, it } from "vitest";
import { buildCompactRequest, compactLabel, compactionMessage, isCompactCommand, isContextOverflow, transcriptOf } from "./compact";
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

  it("ignore un compactage en cours (resume partiel)", () => {
    const t = transcriptOf([user("salut"), { ...agent("1. Demande…"), compacting: true }]);
    expect(t).toBe("Utilisateur : salut");
  });
});

describe("compactionMessage", () => {
  it("porte le marqueur et le resume", () => {
    const m = compactionMessage("résumé du fil", "m1", 42);
    expect(m).toMatchObject({ id: "m1", role: "assistant", content: "résumé du fil", compaction: true, createdAt: 42 });
    expect(m.steps).toEqual([{ type: "text", text: "résumé du fil" }]);
  });

  it("retient qui a compacte, et le libelle suit", () => {
    expect(compactionMessage("r", "m", 1).compactedBy).toBe("user");
    expect(compactionMessage("r", "m", 1, "auto").compactedBy).toBe("auto");
    expect(compactLabel(compactionMessage("r", "m", 1))).toBe("Conversation compactée");
    expect(compactLabel(compactionMessage("r", "m", 1, "auto"))).toBe("Conversation compactée automatiquement — fenêtre pleine");
    expect(compactLabel(compactionMessage("r", "m", 1, "overflow"))).toBe("Conversation compactée automatiquement — contexte dépassé");
  });
});

/* L'erreur « contexte depasse » n'est pas transitoire : relancer tel quel
   echouerait pareil. Il faut la reconnaitre pour compacter puis rejouer. */
describe("isContextOverflow", () => {
  const err = (message: string, status?: number) => Object.assign(new Error(message), status === undefined ? {} : { status });

  it("reconnait les formulations des fournisseurs", () => {
    expect(isContextOverflow(err("This endpoint's maximum context length is 128000 tokens. However, you requested about 131000 tokens", 400))).toBe(true);
    expect(isContextOverflow(err("prompt is too long: 213000 tokens > 200000 maximum", 400))).toBe(true);
    expect(isContextOverflow(err("This model's maximum context length is 8192 tokens", 400))).toBe(true);
    expect(isContextOverflow(err("input length and `max_tokens` exceed context limit", 400))).toBe(true);
    expect(isContextOverflow(err("Request too large: too many tokens", 413))).toBe(true);
  });

  it("ne confond pas un autre 400, une autre erreur, ni un arret volontaire", () => {
    expect(isContextOverflow(err("Invalid model id", 400))).toBe(false);
    expect(isContextOverflow(err("context length exceeded", 500))).toBe(false);
    expect(isContextOverflow(err("Le fournisseur a répondu 400.", 400))).toBe(false);
    expect(isContextOverflow(new DOMException("Interrompu", "AbortError"))).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
  });

  it("accepte le message seul quand le statut manque", () => {
    expect(isContextOverflow(err("maximum context length is 32000 tokens"))).toBe(true);
  });
});
