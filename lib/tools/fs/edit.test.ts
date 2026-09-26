import { describe, expect, test } from "vitest";
import { applyEdit } from "./edit";

describe("applyEdit", () => {
  test("replaces a unique occurrence", () => {
    expect(applyEdit("a b c", "b", "X")).toEqual({ ok: true, content: "a X c", count: 1 });
  });

  test("refuses when the string is not found", () => {
    expect(applyEdit("a b c", "z", "X")).toMatchObject({ ok: false, reason: "not_found" });
  });

  test("refuses an ambiguous match unless replace_all", () => {
    expect(applyEdit("b a b", "b", "X")).toMatchObject({ ok: false, reason: "ambiguous", count: 2 });
    expect(applyEdit("b a b", "b", "X", true)).toEqual({ ok: true, content: "X a X", count: 2 });
  });

  test("refuses an empty search string", () => {
    expect(applyEdit("abc", "", "X")).toMatchObject({ ok: false, reason: "empty" });
  });

  test("refuses a no-op edit", () => {
    expect(applyEdit("abc", "b", "b")).toMatchObject({ ok: false, reason: "same" });
  });

  test("a Windows (CRLF) file matches an excerpt written with \\n, and keeps its endings", () => {
    const out = applyEdit("a\r\nb\r\nc\r\n", "a\nb", "x\ny");
    expect(out).toEqual({ ok: true, content: "x\r\ny\r\nc\r\n", count: 1 });
    expect(applyEdit("a\r\nb\r\n", "b", "z")).toEqual({ ok: true, content: "a\r\nz\r\n", count: 1 });
    expect(applyEdit("a\r\nb\r\n", "q\nb", "z")).toMatchObject({ ok: false, reason: "not_found" });
  });
});
