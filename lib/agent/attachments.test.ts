import { describe, expect, it } from "vitest";
import { RESEARCH_DIRECTIVE, attachmentNote, isImageName, safeFileName, withDirectives } from "./attachments";

describe("safeFileName", () => {
  it("garde un nom simple", () => {
    expect(safeFileName("btc_4h.csv")).toBe("btc_4h.csv");
    expect(safeFileName("Rapport final.pdf")).toBe("Rapport final.pdf");
  });

  it("retire tout chemin et tout caractere qui en ferait un", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\a.csv")).toBe("a.csv");
    expect(safeFileName("a/b/c.txt")).toBe("c.txt");
    expect(safeFileName('bizarre:"|?*.txt')).toBe("bizarre.txt");
  });

  it("ne rend jamais un nom vide ni un nom cache", () => {
    expect(safeFileName("")).toMatch(/^fichier/);
    expect(safeFileName("...")).toMatch(/^fichier/);
    expect(safeFileName(".env")).toBe("env");
  });

  it("borne la longueur en gardant l'extension", () => {
    const n = safeFileName("a".repeat(300) + ".csv");
    expect(n.length).toBeLessThanOrEqual(80);
    expect(n.endsWith(".csv")).toBe(true);
  });
});

describe("isImageName", () => {
  it("reconnait les images par leur extension", () => {
    expect(isImageName("capture.PNG")).toBe(true);
    expect(isImageName("photo.jpeg")).toBe(true);
    expect(isImageName("donnees.csv")).toBe(false);
    expect(isImageName("sans-extension")).toBe(false);
  });
});

describe("attachmentNote", () => {
  it("sans piece jointe, rien", () => {
    expect(attachmentNote([])).toBe("");
  });

  it("liste les chemins, et distingue les images", () => {
    const note = attachmentNote([
      { name: "btc.csv", path: "entrees/btc.csv", kind: "file" },
      { name: "capture.png", path: "entrees/capture.png", kind: "image" },
    ]);
    expect(note).toContain("entrees/btc.csv");
    expect(note).toContain("entrees/capture.png");
    expect(note).toContain("image");
  });
});

describe("withDirectives", () => {
  it("sans rien, le texte passe tel quel", () => {
    expect(withDirectives("bonjour", [], false)).toBe("bonjour");
  });

  it("ajoute la note des pieces jointes apres le message", () => {
    const out = withDirectives("regarde ça", [{ name: "a.csv", path: "entrees/a.csv", kind: "file" }], false);
    expect(out.startsWith("regarde ça")).toBe(true);
    expect(out).toContain("entrees/a.csv");
  });

  it("ajoute la consigne de recherche approfondie avant le message", () => {
    const out = withDirectives("qui gagne le marché des ETF ?", [], true);
    expect(out.startsWith(RESEARCH_DIRECTIVE)).toBe(true);
    expect(out).toContain("qui gagne le marché des ETF ?");
  });

  it("un message vide avec une piece jointe reste exploitable", () => {
    const out = withDirectives("", [{ name: "a.png", path: "entrees/a.png", kind: "image" }], false);
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("entrees/a.png");
  });
});
