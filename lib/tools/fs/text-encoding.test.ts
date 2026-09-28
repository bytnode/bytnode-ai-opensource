import { describe, expect, test } from "vitest";
import { decodeForReading, decodeText, encodeText } from "./text-encoding";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("decodeText", () => {
  test("UTF-8, with or without BOM, round-trips byte for byte", () => {
    for (const buf of [Buffer.from("café € 日本\n"), Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from("bom\r\n")])]) {
      const d = decodeText(buf);
      expect(d.ok).toBe(true);
      if (d.ok) expect(Buffer.from(encodeText(d.text, d.encoding))).toEqual(buf);
    }
  });

  test("UTF-16 with a BOM (Windows PowerShell 5.1) round-trips", () => {
    const le = Buffer.concat([bytes(0xff, 0xfe), Buffer.from("hello é\r\n", "utf16le")]);
    const d = decodeText(le);
    expect(d).toMatchObject({ ok: true, text: "hello é\r\n", encoding: "utf16le" });
    if (d.ok) expect(Buffer.from(encodeText(d.text, d.encoding))).toEqual(le);
    const be = bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0x69);
    const dbe = decodeText(be);
    expect(dbe).toMatchObject({ ok: true, text: "hi", encoding: "utf16be" });
    if (dbe.ok) expect(encodeText(dbe.text, dbe.encoding)).toEqual(be);
  });

  test("Windows-1252 / Latin-1 is not UTF-8; a NUL byte is binary", () => {
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b, 0x0a))).toEqual({ ok: false, reason: "not-utf8" });
    expect(decodeText(bytes(0x00, 0x41, 0x42, 0xff, 0xfe, 0x43))).toEqual({ ok: false, reason: "binary" });
  });
});

describe("decodeForReading", () => {
  test("reads a cp1252 file as such, and says so", () => {
    expect(decodeForReading(bytes(0x63, 0x61, 0x66, 0xe9))).toEqual({ text: "café", note: "not UTF-8: read as Windows-1252" });
  });
  test("UTF-16 is text, a binary is not", () => {
    expect(decodeForReading(Buffer.concat([bytes(0xff, 0xfe), Buffer.from("x", "utf16le")]))).toEqual({ text: "x", note: "UTF-16" });
    expect(decodeForReading(bytes(0x00, 0x01))).toBeNull();
  });
});
