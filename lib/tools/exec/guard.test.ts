import path from "node:path";
import { describe, expect, test } from "vitest";
import { findOutsideReferences, workspaceRefusal } from "./guard";

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

  /* Git bash drives exist on Windows only: elsewhere `/c` is not at the root,
     so it reads as a route and passes — pinned to win32 so CI agrees. */
  test("flags Unix-style absolute paths (Git bash drives) but not /dev/null", () => {
    for (const rootExists of [() => true, () => false]) {
      const opts = { platform: "win32" as const, rootExists };
      expect(findOutsideReferences("cat /c/Users/fremo/x", ws, opts)).toEqual(["/c/Users/fremo/x"]);
      expect(findOutsideReferences("echo hi > /dev/null", ws, opts)).toEqual([]);
    }
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

  test("a lone / between operands is a division, not the root", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const opts = { platform, rootExists: () => true };
      expect(findOutsideReferences('python -c "print(10 / 2)"', ws, opts)).toEqual([]);
      expect(findOutsideReferences("10 / 2", ws, opts)).toEqual([]);
      expect(findOutsideReferences("$total / $count", ws, opts)).toEqual([]);
      expect(findOutsideReferences("echo $(( (a+b) / 2 ))", ws, opts)).toEqual([]);
      expect(findOutsideReferences("ls /", ws, opts)).toEqual(["/"]);
      expect(findOutsideReferences("cd / && ls", ws, opts)).toEqual(["/"]);
    }
  });

  test("/dev/zero and /dev/urandom are devices, not places", () => {
    expect(findOutsideReferences("head -c 3000000 /dev/zero | tr '\\0' 'a'", ws, { platform: "win32" })).toEqual([]);
    expect(findOutsideReferences("head -c 16 /dev/urandom | base64", ws, { platform: "win32" })).toEqual([]);
  });
});

/* Ordinary relative syntax used to slip through: only a token STARTING
   with `..` was read. */
describe("findOutsideReferences: climbing out, however it is written", () => {
  test("a .. segment anywhere in the token", () => {
    expect(findOutsideReferences("ls ./../", ws)).toEqual(["./../"]);
    expect(findOutsideReferences("mkdir -p sub; ls sub/../../", ws)).toEqual(["sub/../../"]);
    expect(findOutsideReferences("type sub\\..\\..\\a2\\notes.md && cat data/../../a2/secret.txt", ws)).toEqual(["sub\\..\\..\\a2\\notes.md", "data/../../a2/secret.txt"]);
    expect(findOutsideReferences("Get-ChildItem .\\..\\", ws)).toEqual([".\\..\\"]);
    expect(findOutsideReferences("Get-ChildItem C:..\\..", ws)).toEqual(["C:..\\.."]);
    expect(findOutsideReferences("--out=./../x.csv", ws)).toEqual(["./../x.csv"]);
  });

  test("the current folder spelled as a variable", () => {
    expect(findOutsideReferences("ls $PWD/../", ws)).toEqual(["$PWD/../"]);
    expect(findOutsideReferences('cat "${PWD}/../x"', ws)).toEqual(["${PWD}/../x"]);
    expect(findOutsideReferences("Get-ChildItem $pwd\\..", ws)).toEqual(["$pwd\\.."]);
    expect(findOutsideReferences("cat $(pwd)/../x", ws).length).toBeGreaterThan(0);
  });

  test("a climb that stays inside, a git range and a dotted name pass", () => {
    expect(findOutsideReferences("cat sub/../notes.md", ws)).toEqual([]);
    expect(findOutsideReferences("ls $PWD/sub/..", ws)).toEqual([]);
    expect(findOutsideReferences("git log HEAD~3..HEAD", ws)).toEqual([]);
    expect(findOutsideReferences("cat ..notes.md", ws)).toEqual([]);
    expect(findOutsideReferences("seq {1..10}", ws)).toEqual([]);
  });

  test("a bare cd / Set-Location goes home", () => {
    expect(findOutsideReferences("cd; ls", ws)).toEqual(["cd (no folder: the home folder)"]);
    expect(findOutsideReferences("cd", ws)).toEqual(["cd (no folder: the home folder)"]);
    expect(findOutsideReferences("Set-Location; Get-Location", ws)).toEqual(["Set-Location (no folder: the home folder)"]);
    expect(findOutsideReferences("ls && cd && pwd", ws)).toEqual(["cd (no folder: the home folder)"]);
    expect(findOutsideReferences("cd sub && ls", ws)).toEqual([]);
    expect(findOutsideReferences("abcd; ls", ws)).toEqual([]);
  });
});

describe("workspaceRefusal", () => {
  test("refuses a call to the app's own API", () => {
    const msg = workspaceRefusal('curl -s -X POST -H "Sec-Fetch-Site: same-origin" http://127.0.0.1:3777/api/user-plugins/u-x/approve', ws);
    expect(msg).toContain("own API");
    expect(workspaceRefusal("Invoke-RestMethod http://localhost:3777/api/tools", ws)).toContain("own API");
  });
  test("refuses an outside path, lets an inside command run", () => {
    expect(workspaceRefusal("cat ../x", ws)).toContain('"../x"');
    expect(workspaceRefusal("curl -s https://api.binance.com/api/v3/time", ws)).toBeNull();
    expect(workspaceRefusal("python script.py", ws)).toBeNull();
  });
});

/* Two false refusals the control audit found. */
describe("findOutsideReferences: the folder a chain runs in, and routes on Windows", () => {
  test("`cd sub && ls ../` lists the workspace, not its parent", () => {
    expect(findOutsideReferences("mkdir -p sub && cd sub && ls ../", ws)).toEqual([]);
    expect(findOutsideReferences("cd sub; cat ../notes.md", ws)).toEqual([]);
    /* …but climbing out from there is still refused. */
    expect(findOutsideReferences("cd sub && ls ../../", ws)).toEqual(["../../"]);
    expect(findOutsideReferences("cd sub && cd .. && ls ..", ws)).toEqual([".."]);
  });

  test("Windows: a root folder that does not exist is a route when nothing is written", () => {
    const opts = { platform: "win32" as const, rootExists: () => false };
    expect(findOutsideReferences('grep -rn "/api/" .', ws, opts)).toEqual([]);
    expect(findOutsideReferences("mkdir /newdir", ws, opts)).toEqual(["/newdir"]);
    expect(findOutsideReferences('echo x > /api/out.txt', ws, opts)).toEqual(["/api/out.txt"]);
    expect(findOutsideReferences("ls /usr/bin", ws, opts)).toEqual(["/usr/bin"]);
  });
});
