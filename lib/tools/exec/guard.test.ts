import path from "node:path";
import { describe, expect, test } from "vitest";
import { findOutsideReferences } from "./guard";

/* Portable: absolute on all three OSes (`C:\Users\…` on Windows, `/Users/…` elsewhere). */
const ws = path.resolve("/Users/fremo/Desktop/cryptos/workspaces/a1");
const wsSlash = ws.replace(/\\/g, "/");

describe("findOutsideReferences", () => {
  test("flags a Windows absolute path outside the workspace, quoted or not", () => {
    expect(findOutsideReferences('Test-Path "C:\\Users\\fremo\\Desktop\\testnova"', ws)).toEqual(["C:\\Users\\fremo\\Desktop\\testnova"]);
    expect(findOutsideReferences("type D:/data/x.txt", ws)).toEqual(["D:/data/x.txt"]);
  });

  test("accepts an absolute path inside the workspace", () => {
    expect(findOutsideReferences(`node "${path.join(ws, "script.js")}"`, ws)).toEqual([]);
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

  test("flags drive-root and UNC paths written with backslashes, and PowerShell ${env:} forms", () => {
    expect(findOutsideReferences("cd \\", ws)).toEqual(["\\"]);
    expect(findOutsideReferences("Get-Content \\Windows\\win.ini", ws)).toEqual(["\\Windows\\win.ini"]);
    expect(findOutsideReferences("dir \\\\server\\share", ws)).toEqual(["\\\\server\\share"]);
    expect(findOutsideReferences("Get-Content ${env:USERPROFILE}\\x", ws)).toEqual(["${env:USERPROFILE}\\x"]);
    expect(findOutsideReferences("ls $env:ProgramFiles", ws)).toEqual(["$env:ProgramFiles"]);
    expect(findOutsideReferences("type %SystemRoot%\\win.ini", ws)).toEqual(["%SystemRoot%\\win.ini"]);
  });

  test("leaves ordinary commands alone", () => {
    expect(findOutsideReferences("git status && npm test -- --watch=false", ws)).toEqual([]);
    expect(findOutsideReferences("Get-ChildItem -Recurse -Filter *.md | Select-Object Name", ws)).toEqual([]);
    expect(findOutsideReferences("node --version", ws)).toEqual([]);
  });
});

/* Read as paths by mistake: URLs, patterns, routes. */
describe("findOutsideReferences: what is not a place", () => {
  test("a URL is not a drive (the `s:/` of https)", () => {
    expect(findOutsideReferences("curl -s https://api.binance.com/api/v3/time", ws)).toEqual([]);
    expect(findOutsideReferences(`python -c "import urllib.request as u; u.urlopen('http://x.io/a')"`, ws)).toEqual([]);
    expect(findOutsideReferences("type D:/data/x.txt", ws)).toEqual(["D:/data/x.txt"]);
  });

  test("a sed / awk pattern is not a path, on every system", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(findOutsideReferences("sed '/^$/d' notes.txt", ws, { platform })).toEqual([]);
      expect(findOutsideReferences("awk '/BTC.*USDT/ { print $2 }' prices.csv", ws, { platform })).toEqual([]);
    }
  });

  test("macOS / Linux: a root folder that does not exist is a route, not a place", () => {
    const rootExists = (name: string) => ["etc", "Users", "usr", "tmp"].includes(name);
    const opts = { platform: "darwin" as const, rootExists };
    expect(findOutsideReferences('grep -rn "/api/" logs', ws, opts)).toEqual([]);
    expect(findOutsideReferences("cat /etc/passwd", ws, opts)).toEqual(["/etc/passwd"]);
    expect(findOutsideReferences("ls /Users/someone/Desktop", ws, opts)).toEqual(["/Users/someone/Desktop"]);
  });

  test("Windows stays strict about a bare root path (PowerShell reads /x as C:/x)", () => {
    expect(findOutsideReferences("mkdir /newdir", ws, { platform: "win32", rootExists: () => false })).toEqual(["/newdir"]);
  });
});
