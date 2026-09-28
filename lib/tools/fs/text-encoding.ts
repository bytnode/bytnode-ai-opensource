/* ---------------------------------------------------------------------------
   What a file's bytes say about its text.

   Windows writes more than UTF-8: Windows PowerShell 5.1's `>` writes
   UTF-16LE with a BOM, Excel and older tools write Windows-1252 ("café" as
   the byte e9). Decoding everything as UTF-8 made Read call a UTF-16 file
   "binary", and — worse — made Edit write a cp1252 file back as UTF-8 with
   every accented byte turned into U+FFFD, reporting success.

   Pure, tested.
--------------------------------------------------------------------------- */

export type TextEncodingName = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export type Decoded =
  | { ok: true; text: string; encoding: TextEncodingName }
  | { ok: false; reason: "binary" | "not-utf8" };

/** The text of a file, when it is text we can write back byte for byte:
    UTF-8 (with or without BOM) or UTF-16 with a BOM. */
export function decodeText(buf: Uint8Array): Decoded {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { ok: true, text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf16le" };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { ok: true, text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf16be" };
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = bom ? buf.subarray(3) : buf;
  if (body.includes(0)) return { ok: false, reason: "binary" };
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: bom ? "utf8-bom" : "utf8" };
  } catch {
    return { ok: false, reason: "not-utf8" };
  }
}

/** The bytes to write for this text in the file's own encoding. */
export function encodeText(text: string, encoding: TextEncodingName): Uint8Array {
  switch (encoding) {
    case "utf8":
      return new TextEncoder().encode(text);
    case "utf8-bom":
      return concat([0xef, 0xbb, 0xbf], new TextEncoder().encode(text));
    case "utf16le":
      return concat([0xff, 0xfe], utf16(text, true));
    case "utf16be":
      return concat([0xfe, 0xff], utf16(text, false));
  }
}

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

function concat(head: number[], body: Uint8Array): Uint8Array {
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

/** For READING only: a text that is not valid UTF-8 and holds no NUL byte
    is most likely Windows-1252 (a superset of Latin-1) — shown decoded that
    way rather than with "�" in place of every accent. */
export function decodeForReading(buf: Uint8Array): { text: string; note?: string } | null {
  const d = decodeText(buf);
  if (d.ok) return { text: d.text, ...(d.encoding.startsWith("utf16") ? { note: "UTF-16" } : {}) };
  if (d.reason === "binary") return null;
  return { text: new TextDecoder("windows-1252").decode(buf), note: "not UTF-8: read as Windows-1252" };
}
