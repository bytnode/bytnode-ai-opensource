import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { OutsideWorkspaceError, displayPath, expandHome, resolvePath } from "./paths";

/* Portable paths: `path.resolve("/x")` gives `C:\x` on Windows and `/x`
   elsewhere — the tests run on all three OSes (GitHub matrix). */
const ws = path.resolve("/tmp/work");
const other = path.resolve("/other/x.txt");

describe("resolvePath, disk scope", () => {
  test("resolves a relative path inside the workspace", () => {
    expect(resolvePath(ws, "src/a.ts", "disk")).toBe(path.join(ws, "src", "a.ts"));
  });

  test("keeps an absolute path anywhere on disk", () => {
    expect(resolvePath(ws, other, "disk")).toBe(other);
  });
});

describe("resolvePath, workspace scope", () => {
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
    expect(() => resolvePath(ws, path.resolve("/tmp/work2/x"), "workspace")).toThrow(OutsideWorkspaceError);
    expect(() => resolvePath(ws, path.resolve("/Windows/system32"), "workspace")).toThrow(OutsideWorkspaceError);
  });

  test("is the default", () => {
    expect(() => resolvePath(ws, other)).toThrow(OutsideWorkspaceError);
  });
});

describe("~, the user's folder", () => {
  test("expands like a shell, never into a folder named ~", () => {
    const home = path.resolve("/home/me");
    expect(expandHome("~/Desktop/x.md", home)).toBe(path.join(home, "Desktop", "x.md"));
    expect(expandHome("~", home)).toBe(home);
    expect(expandHome("notes/~draft.md", home)).toBe("notes/~draft.md");
  });

  test("the workspace scope refuses it, the disk scope reaches it", () => {
    expect(() => resolvePath(ws, "~/Desktop/x.md")).toThrow(OutsideWorkspaceError);
    expect(resolvePath(ws, "~/Desktop/x.md", "disk")).toBe(path.join(os.homedir(), "Desktop", "x.md"));
  });
});

describe("displayPath", () => {
  test("shows workspace paths relative, with forward slashes", () => {
    expect(displayPath(ws, path.join(ws, "src", "a.ts"))).toBe("src/a.ts");
    expect(displayPath(ws, ws)).toBe(".");
  });

  test("shows outside paths absolute", () => {
    expect(displayPath(ws, other)).toBe(other.split(path.sep).join("/"));
  });
});
