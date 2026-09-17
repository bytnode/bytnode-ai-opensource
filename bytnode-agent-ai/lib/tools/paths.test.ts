import path from "node:path";
import { describe, expect, test } from "vitest";
import { OutsideWorkspaceError, displayPath, resolvePath } from "./paths";

const ws = path.resolve("C:/tmp/work");

describe("resolvePath, périmètre disk", () => {
  test("resolves a relative path inside the workspace", () => {
    expect(resolvePath(ws, "src/a.ts", "disk")).toBe(path.join(ws, "src", "a.ts"));
  });

  test("keeps an absolute path anywhere on disk", () => {
    expect(resolvePath(ws, "C:/other/x.txt", "disk")).toBe(path.resolve("C:/other/x.txt"));
  });
});

describe("resolvePath, périmètre workspace", () => {
  test("accepts paths inside, relative or absolute", () => {
    expect(resolvePath(ws, "src/a.ts", "workspace")).toBe(path.join(ws, "src", "a.ts"));
    expect(resolvePath(ws, path.join(ws, "x"), "workspace")).toBe(path.join(ws, "x"));
    expect(resolvePath(ws, ".", "workspace")).toBe(ws);
  });

  test("refuses a path that climbs out", () => {
    expect(() => resolvePath(ws, "../secret", "workspace")).toThrow(OutsideWorkspaceError);
    expect(() => resolvePath(ws, "src/../../secret", "workspace")).toThrow(OutsideWorkspaceError);
  });

  test("refuses an absolute path elsewhere, even with a look-alike prefix", () => {
    expect(() => resolvePath(ws, "C:/tmp/work2/x", "workspace")).toThrow(OutsideWorkspaceError);
    expect(() => resolvePath(ws, "C:/Windows/system32", "workspace")).toThrow(OutsideWorkspaceError);
  });

  test("is the default", () => {
    expect(() => resolvePath(ws, "C:/other/x.txt")).toThrow(OutsideWorkspaceError);
  });
});

describe("displayPath", () => {
  test("shows workspace paths relative, with forward slashes", () => {
    expect(displayPath(ws, path.join(ws, "src", "a.ts"))).toBe("src/a.ts");
    expect(displayPath(ws, ws)).toBe(".");
  });

  test("shows outside paths absolute", () => {
    expect(displayPath(ws, path.resolve("C:/other/x.txt"))).toBe("C:/other/x.txt");
  });
});
