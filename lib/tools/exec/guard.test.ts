import path from "node:path";
import { describe, expect, test } from "vitest";
import { findOutsideReferences } from "./guard";

const ws = path.resolve("C:/Users/fremo/Desktop/cryptos/workspaces/a1");
const wsSlash = ws.replace(/\\/g, "/");

describe("findOutsideReferences", () => {
  test("flags a Windows absolute path outside the workspace, quoted or not", () => {
    expect(findOutsideReferences('Test-Path "C:\\Users\\fremo\\Desktop\\testnova"', ws)).toEqual(["C:\\Users\\fremo\\Desktop\\testnova"]);
    expect(findOutsideReferences("type D:/data/x.txt", ws)).toEqual(["D:/data/x.txt"]);
  });

  test("accepts an absolute path inside the workspace", () => {
    expect(findOutsideReferences(`node "${ws}\\script.js"`, ws)).toEqual([]);
    expect(findOutsideReferences(`cat ${wsSlash}/notes/a.md`, ws)).toEqual([]);
  });

  test("flags a relative path that climbs out, accepts one that stays in", () => {
    expect(findOutsideReferences("ls ../..", ws)).toEqual(["../.."]);
    expect(findOutsideReferences("cat ../secret.txt", ws)).toEqual(["../secret.txt"]);
    expect(findOutsideReferences("cat src/../lib/a.ts", ws)).toEqual([]);
  });

  test("flags Unix-style absolute paths (Git bash drives) but not /dev/null", () => {
    expect(findOutsideReferences("cat /c/Users/fremo/x", ws)).toEqual(["/c/Users/fremo/x"]);
    expect(findOutsideReferences("echo hi > /dev/null", ws)).toEqual([]);
  });

  test("flags home and environment shortcuts", () => {
    expect(findOutsideReferences("cd ~", ws)).toEqual(["~"]);
    expect(findOutsideReferences("Get-Content $env:USERPROFILE\\x", ws)).toEqual(["$env:USERPROFILE\\x"]);
    expect(findOutsideReferences("dir %APPDATA%", ws)).toEqual(["%APPDATA%"]);
    expect(findOutsideReferences("ls $HOME/.ssh", ws)).toEqual(["$HOME/.ssh"]);
  });

  test("leaves ordinary commands alone", () => {
    expect(findOutsideReferences("git status && npm test -- --watch=false", ws)).toEqual([]);
    expect(findOutsideReferences("Get-ChildItem -Recurse -Filter *.md | Select-Object Name", ws)).toEqual([]);
    expect(findOutsideReferences("node --version", ws)).toEqual([]);
  });
});
