import { describe, expect, it } from "vitest";
import { RESEARCH_DIRECTIVE, attachmentNote, isImageName, safeFileName, withDirectives } from "./attachments";

describe("safeFileName", () => {
  it("keeps a simple name", () => {
    expect(safeFileName("btc_4h.csv")).toBe("btc_4h.csv");
    expect(safeFileName("Rapport final.pdf")).toBe("Rapport final.pdf");
  });

  it("strips any path and any character that would make one", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\a.csv")).toBe("a.csv");
    expect(safeFileName("a/b/c.txt")).toBe("c.txt");
    expect(safeFileName('bizarre:"|?*.txt')).toBe("bizarre.txt");
  });

  it("never yields an empty name nor a hidden one", () => {
    expect(safeFileName("")).toMatch(/^file/);
    expect(safeFileName("...")).toMatch(/^file/);
    expect(safeFileName(".env")).toBe("env");
  });

  it("never a Windows device name, a trailing dot or space, nor a bidi control", () => {
    for (const n of ["CON", "AUX", "COM1", "NUL.txt", "con.txt", "LPT1.log", "prn.csv", "CONIN$"]) expect(safeFileName(n), n).toBe(`_${n}`);
    expect(safeFileName("trailing.")).toBe("trailing");
    expect(safeFileName("report.csv . ")).toBe("report.csv");
    expect(safeFileName(`${String.fromCharCode(0x202e)}gnp.exe`)).toBe("gnp.exe");
    expect(safeFileName(`a${String.fromCharCode(0x2066)}b${String.fromCharCode(0x2069)}.txt`)).toBe("ab.txt");
    expect(safeFileName("console.log")).toBe("console.log");
    expect(safeFileName("nullable.csv")).toBe("nullable.csv");
  });

  it("bounds the length while keeping the extension", () => {
    const n = safeFileName("a".repeat(300) + ".csv");
    expect(n.length).toBeLessThanOrEqual(80);
    expect(n.endsWith(".csv")).toBe(true);
  });
});

describe("isImageName", () => {
  it("recognises images by their extension", () => {
    expect(isImageName("capture.PNG")).toBe(true);
    expect(isImageName("photo.jpeg")).toBe(true);
    expect(isImageName("donnees.csv")).toBe(false);
    expect(isImageName("sans-extension")).toBe(false);
  });
});

describe("attachmentNote", () => {
  it("without an attachment, nothing", () => {
    expect(attachmentNote([])).toBe("");
  });

  it("lists the paths, and singles out images", () => {
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
  it("with nothing, the text passes through as is", () => {
    expect(withDirectives("bonjour", [], false)).toBe("bonjour");
  });

  it("adds the attachment note after the message", () => {
    const out = withDirectives("regarde ça", [{ name: "a.csv", path: "entrees/a.csv", kind: "file" }], false);
    expect(out.startsWith("regarde ça")).toBe(true);
    expect(out).toContain("entrees/a.csv");
  });

  it("adds the deep research directive before the message", () => {
    const out = withDirectives("qui gagne le marché des ETF ?", [], true);
    expect(out.startsWith(RESEARCH_DIRECTIVE)).toBe(true);
    expect(out).toContain("qui gagne le marché des ETF ?");
  });

  it("an empty message with an attachment stays usable", () => {
    const out = withDirectives("", [{ name: "a.png", path: "entrees/a.png", kind: "image" }], false);
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("entrees/a.png");
  });
});
