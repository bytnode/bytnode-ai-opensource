import { describe, expect, it } from "vitest";
import { containing, forbiddenPaths, isTextFile, leakedSecrets } from "./pack-check";

describe("forbiddenPaths", () => {
  it("refuse les fichiers d'environnement, les donnees et les cles MCP", () => {
    expect(forbiddenPaths([".env.local", "workspaces/a/x.txt", "sandboxes/b", ".mcp.json", "scratchpad/t.mts", "lib/.env"])).toEqual([
      ".env.local",
      "workspaces/a/x.txt",
      "sandboxes/b",
      ".mcp.json",
      "scratchpad/t.mts",
      "lib/.env",
    ]);
  });
  it("laisse passer le paquet", () => {
    expect(forbiddenPaths(["bin/bytnode-ai.mjs", ".next/BUILD_ID", "lib/mcp/finance-server.ts", "professions/standard/PROMPT.md", "README.md"])).toEqual([]);
  });
});

describe("leakedSecrets", () => {
  it("nomme les fichiers qui contiennent une cle", () => {
    const files = [
      { path: "lib/a.ts", text: "const k = 'cb_live_abcdefghijklmnop';" },
      { path: "lib/b.ts", text: "fetch(url, { headers: { Authorization: 'Bearer sk-or-v1-0123456789abcdef' } })" },
      { path: "lib/c.ts", text: "const prefix = 'cb_live_';" },
    ];
    expect(leakedSecrets(files)).toEqual(["lib/a.ts", "lib/b.ts"]);
  });
});

describe("isTextFile", () => {
  it("ne lit que le texte", () => {
    expect(isTextFile("lib/a.ts")).toBe(true);
    expect(isTextFile(".next/static/chunks/x.js")).toBe(true);
    expect(isTextFile("professions/x/image.png")).toBe(false);
  });
});

describe("containing", () => {
  it("nomme les fichiers qui citent la machine de build, sous les deux ecritures", () => {
    const root = String.raw`C:\Users\x\proj`;
    const rootJson = JSON.stringify(root).slice(1, -1); // C:\\Users\\x\\proj
    const files = [
      { path: ".next/required-server-files.json", text: `{"appDir":"${rootJson}"}` },
      { path: ".next/a.js", text: root },
      { path: "lib/b.ts", text: "rien" },
    ];
    expect(containing(files, [root, rootJson])).toEqual([".next/required-server-files.json", ".next/a.js"]);
  });
  it("ignore une aiguille vide", () => {
    expect(containing([{ path: "a", text: "abc" }], [""])).toEqual([]);
  });
});
