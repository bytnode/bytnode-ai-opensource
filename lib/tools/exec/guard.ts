import fs from "node:fs";
import path from "node:path";
import { isInside } from "../paths";
import { LOCAL_API_MESSAGE, targetsLocalApi } from "./local-api";

/* ---------------------------------------------------------------------------
   The command guard, for the "workspace" scope.

   A shell cannot be confined: Windows has no chroot, and a system sandbox
   would be another project. What can be done is to READ THE COMMAND before
   launching it and refuse one that designates a place outside the
   workspace: an absolute path (`C:\\…`, `/c/…`, `/…`), a relative path that
   climbs above the root (`../x`, `sub/../../x`, `$PWD/..`), a shortcut to
   the account (`~`, `$HOME`, `$env:USERPROFILE`, `%APPDATA%`…, or a bare
   `cd` / `Set-Location`, which goes home). A call to the app's own API is
   refused too (`local-api.ts`).

   ⚠️ IT IS A GUARD ON THE TEXT, NOT A PRISON. A command that builds its
   path some other way (computed variable, encoding) would pass. It stops
   ordinary use and mistakes; against a model that would try to work around
   it, it is the "ask before acting" mode that protects.
--------------------------------------------------------------------------- */

/* ⚠️ The drive letter must START a word: without that, the `s:/` of
   `https://…` was read as a drive and every `curl https://…` refused. */
const WIN_ABS = /(?:"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'|(?<![A-Za-z0-9_])([A-Za-z]:[\\/][^\s"'|&;<>()]*))/g;
const UNIX_ABS = /(?:^|[\s"'=(|&;<>])(\/[^\s"'|&;<>()]*)/g;
/* A token holding a `..` SEGMENT, wherever it sits: `../x`, `./../x`,
   `sub/../../x`, `$PWD/..`, `.\..\`, `C:..\..` (drive-relative) — not a git
   range (`HEAD..main`) nor a name such as `..notes.md`. Each is resolved
   against the workspace and kept only when it lands outside. `)` counts as a
   separator so that `$(pwd)/../x` is read too. */
const DOTDOT_TOKEN = /(?:^|[\s"'=(|&;<>)])([^\s"'|&;<>()=]*\.\.[^\s"'|&;<>()=]*)/g;
const DOTDOT_SEGMENT = /(?:^|[\\/:])\.\.(?:[\\/]|$)/;
/* What stands for the current folder at the start of a path (after the
   backslashes became slashes). */
const CWD_PREFIX = /^(?:\$\{?pwd\}?|\$\(pwd\))(?=\/|$)/i;
/* A shell's "go home": `cd`, `Set-Location`… with no folder at all. */
const BARE_CD = /(?:^|[;&|(\n{]\s*)(cd|chdir|pushd|set-location|sl|push-location)[ \t]*(?=$|[;&|)}\n])/gim;
/* The environment variables that designate a location: the account, the
   system and program folders, the temporary ones. In their three forms:
   `$env:X`, `${env:X}`, `%X%`. */
const PLACES = "USERPROFILE|HOMEPATH|HOMEDRIVE|HOME|APPDATA|LOCALAPPDATA|PROGRAMDATA|ALLUSERSPROFILE|PUBLIC|ONEDRIVE|TEMP|TMP|SYSTEMROOT|SYSTEMDRIVE|WINDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES";
const HOME = new RegExp(
  `(?:^|[\\s"'=(|&;<>])((?:~|\\$HOME|\\$\\{HOME\\}|\\$env:(?:${PLACES})|\\$\\{env:(?:${PLACES})\\}|%(?:${PLACES})%|\\$PSScriptRoot)(?:[\\\\/][^\\s"'|&;<>()]*)?)(?=$|[\\s"'|&;<>()])`,
  "gi",
);
/* A path starting at the root of the current drive (`\Windows`) or a
   network share (`\\server\share`): outside the folder by construction. */
const WIN_ROOT = /(?:^|[\s"'=(|&;<>])(\\{1,2}[^\s"'|&;<>()]*)/g;
/* …but a lone escape is no path: `tr '\0' 'a'`, `echo -e '\n'`, `'\x41'`. */
const ESCAPE = /^\\(?:[0-7]{1,3}|[nrtabefv]|x[0-9a-f]{1,2}|u[0-9a-f]{4})$/i;

const ALLOWED_UNIX = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/zero", "/dev/urandom", "/dev/random"]);

/* A lone `/` between two operands is a division (`python -c "print(10 / 2)"`,
   PowerShell `10 / 2`, `$a / $b`), not the root: the token before it is a
   number, a variable or a closing parenthesis, or the one after it is a
   number, a variable or an opening one. `ls /` and `cd / && …` stay refused. */
function isDivision(command: string, at: number): boolean {
  const before = command.slice(0, at).match(/(\S+)\s*$/)?.[1] ?? "";
  const after = command.slice(at + 1).match(/^\s*(\S+)/)?.[1] ?? "";
  return /^(?:[\d.]+|\$[\w:{}]+|.*\))$/.test(before) || /^(?:\d|\(|\$)/.test(after);
}

/* A "/…/" that is a pattern, not a path: `sed '/^$/d'`, `awk '/x+/'`. A
   first segment with a regex character names no folder anyone has. */
const PATTERN = /^\/[^/]*[\^$*+?[\]{}\\|]/;

type GuardOptions = {
  platform?: NodeJS.Platform;
  /** Does `/<name>` exist at the root of the disk (on Windows: of the
      workspace's drive)? */
  rootExists?: (name: string) => boolean;
};

/* Git bash's own roots on Windows (they exist there, in Git's folder). */
const GIT_BASH_ROOTS = new Set(["bin", "usr", "etc", "tmp", "dev", "proc", "mingw64", "mingw32", "ucrt64", "clang64", "opt", "var", "home", "cmd", "lib", "sbin", "cygdrive"]);
/* A command that creates or writes: on Windows it may create `C:\x` from a
   `/x` that does not exist yet, so the leniency below does not apply. */
const WRITES = /(?:^|[\s;&|(])(?:mkdir|md|ni|new-item|out-file|set-content|add-content|sc|ac|tee|touch|cp|copy|copy-item|mv|move|move-item|rename-item|ren|install)(?=\s|$)|>/i;

/* The folder each part of a chain runs in: `cd sub && ls ../` lists the
   workspace, not its parent. Only a plain `cd <relative folder>` moves it
   (never out of the workspace: a climb out is refused anyway). */
const CHAIN_SEP = /&&|\|\||[;\n|]/g;
const PLAIN_CD = /^\s*(?:cd|chdir|pushd|set-location|sl|push-location)\s+(["']?)([^\s"'`$~;&|<>()]+)\1\s*$/i;
function cwdAt(command: string, workspace: string): (index: number) => string {
  const parts: Array<{ end: number; cwd: string }> = [];
  let cwd = workspace;
  let start = 0;
  const seps = [...command.matchAll(CHAIN_SEP), { index: command.length, 0: "" } as RegExpMatchArray];
  for (const sep of seps) {
    const end = sep.index ?? command.length;
    parts.push({ end, cwd });
    const m = command.slice(start, end).match(PLAIN_CD);
    if (m && !/^(?:[A-Za-z]:|[\\/])/.test(m[2])) {
      const next = path.resolve(cwd, m[2].replace(/\\/g, "/"));
      if (isInside(workspace, next)) cwd = next;
    }
    start = end + sep[0].length;
  }
  return (index) => parts.find((p) => index <= p.end)?.cwd ?? workspace;
}

/** The references outside the workspace found in the command, as written.
    Empty when the command stays inside. */
export function findOutsideReferences(command: string, workspace: string, opts: GuardOptions = {}): string[] {
  const platform = opts.platform ?? process.platform;
  const driveRoot = platform === "win32" ? path.parse(path.resolve(workspace)).root : "/";
  const rootExists = opts.rootExists ?? ((name: string) => fs.existsSync(path.join(driveRoot, name)));
  const cwdOf = cwdAt(command, workspace);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  };

  for (const m of command.matchAll(WIN_ABS)) {
    const p = m[1] ?? m[2] ?? m[3];
    if (p && !isInside(workspace, path.resolve(p))) push(p);
  }
  for (const m of command.matchAll(UNIX_ABS)) {
    const p = m[1];
    if (!p || ALLOWED_UNIX.has(p) || PATTERN.test(p)) continue;
    if (p === "/" && isDivision(command, (m.index ?? 0) + m[0].length - 1)) continue;
    /* A first folder that does not exist at the root is a URL route or a
       pattern (`grep "/api/"`): on macOS / Linux nobody but root could
       create it there. On Windows PowerShell reads `/x` as `C:\x`, which
       any user may create — so there it only passes when the command
       writes nothing, and never for Git bash's own roots (`/usr`, `/tmp`). */
    const top = p.split("/")[1];
    if (top && !rootExists(top)) {
      if (platform !== "win32") continue;
      if (!/^[A-Za-z]$/.test(top) && !GIT_BASH_ROOTS.has(top.toLowerCase()) && !WRITES.test(command)) continue;
    }
    /* On Windows, `/c/Users/…` is the C: drive as seen from Git bash and the
       other roots (`/usr`, `/tmp`) are outside the folder by construction.
       On macOS/Linux, it is simply an absolute path: it is compared to the
       folder, otherwise every absolute path INSIDE the folder would be refused. */
    const drive = platform === "win32" ? p.match(/^\/([A-Za-z])\/(.*)$/) : null;
    const resolved = platform !== "win32" ? path.resolve(p) : drive ? path.resolve(`${drive[1]}:/${drive[2]}`) : null;
    if (!resolved || !isInside(workspace, resolved)) push(p);
  }
  for (const m of command.matchAll(DOTDOT_TOKEN)) {
    const p = m[1];
    if (!p || !DOTDOT_SEGMENT.test(p)) continue;
    /* Slashes on every system, so the test gives the same answer on the
       three OSes; a drive-relative `C:..` climbs from the current folder. */
    const rel = p.replace(/\\/g, "/").replace(CWD_PREFIX, ".").replace(/^[A-Za-z]:(?!\/)/, "");
    if (!isInside(workspace, path.resolve(cwdOf(m.index ?? 0), rel))) push(p);
  }
  for (const m of command.matchAll(BARE_CD)) {
    push(`${m[1]} (no folder: the home folder)`);
  }
  for (const m of command.matchAll(HOME)) {
    if (m[1]) push(m[1]);
  }
  for (const m of command.matchAll(WIN_ROOT)) {
    if (m[1] && !ESCAPE.test(m[1])) push(m[1]);
  }
  return out;
}

export function outsideMessage(refs: string[]): string {
  return (
    `Command refused: it references a location outside the workspace (${refs.map((r) => `"${r}"`).join(", ")}). ` +
    "This agent's scope is limited to its workspace; work with relative paths inside it, or ask the user to widen the scope to the whole disk in the agent's settings."
  );
}

/** What the workspace scope refuses in a command, as the message for the
    model, or `null` when the command may run. */
export function workspaceRefusal(command: string, workspace: string, opts: GuardOptions = {}): string | null {
  if (targetsLocalApi(command)) return LOCAL_API_MESSAGE;
  const refs = findOutsideReferences(command, workspace, opts);
  return refs.length ? outsideMessage(refs) : null;
}
