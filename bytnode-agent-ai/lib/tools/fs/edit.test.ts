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
});
