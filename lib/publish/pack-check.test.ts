import { describe, expect, it } from "vitest";
import { containing, forbiddenPaths, isTextFile, leakedSecrets, machinePathNeedles } from "./pack-check";

describe("forbiddenPaths", () => {
  it("refuses environment files, data and MCP keys", () => {
    expect(forbiddenPaths([".env.local", "workspaces/a/x.txt", "sandboxes/b", ".mcp.json", "scratchpad/t.mts", "lib/.env"])).toEqual([
      ".env.local",
      "workspaces/a/x.txt",
      "sandboxes/b",
      ".mcp.json",
      "scratchpad/t.mts",
      "lib/.env",
    ]);
  });
  it("lets the package through", () => {
    expect(forbiddenPaths(["bin/bytnode-ai.mjs", ".next/BUILD_ID", "lib/mcp/finance-server.ts", "professions/standard/PROMPT.md", "README.md"])).toEqual([]);
  });
});

describe("leakedSecrets", () => {
  it("names the files that contain a key", () => {
    const files = [
      { path: "lib/a.ts", text: "const k = 'cb_live_abcdefghijklmnop';" },
      { path: "lib/b.ts", text: "fetch(url, { headers: { Authorization: 'Bearer sk-or-v1-0123456789abcdef' } })" },
      { path: "lib/c.ts", text: "const prefix = 'cb_live_';" },
    ];
    expect(leakedSecrets(files)).toEqual(["lib/a.ts", "lib/b.ts"]);
  });
});

describe("isTextFile", () => {
  it("only reads text", () => {
    expect(isTextFile("lib/a.ts")).toBe(true);
    expect(isTextFile(".next/static/chunks/x.js")).toBe(true);
    expect(isTextFile("professions/x/image.png")).toBe(false);
  });
});

describe("containing", () => {
  it("names the files that cite the build machine, in both spellings", () => {
    const root = String.raw`C:\Users\x\proj`;
    const rootJson = JSON.stringify(root).slice(1, -1); // C:\\Users\\x\\proj
    const files = [
      { path: ".next/required-server-files.json", text: `{"appDir":"${rootJson}"}` },
      { path: ".next/a.js", text: root },
      { path: "lib/b.ts", text: "nothing" },
    ];
    expect(containing(files, [root, rootJson])).toEqual([".next/required-server-files.json", ".next/a.js"]);
  });
  it("ignores an empty needle", () => {
    expect(containing([{ path: "a", text: "abc" }], [""])).toEqual([]);
  });

  it("catches the path in a source map's file URL and in forward slashes", () => {
    const needles = machinePathNeedles(String.raw`C:\Users\x\proj`);
    const files = [
      { path: ".next/server/a.js.map", text: `{"sources":["file:///C:/Users/x/proj/lib/a.ts"]}` },
      { path: ".next/server/b.js", text: `"[project]" /* C:/Users/x/proj */` },
    ];
    expect(containing(files, needles)).toEqual([".next/server/a.js.map", ".next/server/b.js"]);
    expect(machinePathNeedles("/home/x/proj")).toEqual(["/home/x/proj", "file:///home/x/proj"]);
  });
});

describe("the dev server's output", () => {
  it("never goes out", () => {
    expect(forbiddenPaths([".next/dev/lock", ".next/server/app.js"])).toEqual([".next/dev/lock"]);
    expect(isTextFile(".next/server/a.js.map")).toBe(true);
  });
});
