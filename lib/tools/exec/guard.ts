import path from "node:path";
import { isInside } from "../paths";

/* ---------------------------------------------------------------------------
   The command guard, for the "workspace" scope.

   A shell cannot be confined: Windows has no chroot, and a system sandbox
   would be another project. What can be done is to READ THE COMMAND before
   launching it and refuse one that designates a place outside the
   workspace: an absolute path (`C:\\…`, `/c/…`, `/…`), a relative path that
   climbs above the root (`../x`), a shortcut to the account (`~`, `$HOME`,
   `$env:USERPROFILE`, `%APPDATA%`…).

   ⚠️ IT IS A GUARD ON THE TEXT, NOT A PRISON. A command that builds its
   path some other way (computed variable, encoding) would pass. It stops
   ordinary use and mistakes; against a model that would try to work around
   it, it is the "ask before acting" mode that protects.
--------------------------------------------------------------------------- */

const WIN_ABS = /(?:"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'|([A-Za-z]:[\\/][^\s"'|&;<>()]*))/g;
const UNIX_ABS = /(?:^|[\s"'=(|&;<>])(\/[^\s"'|&;<>()]*)/g;
const RELATIVE_UP = /(?:^|[\s"'=(|&;<>])((?:\.\.[\\/])[^\s"'|&;<>()]*|\.\.)(?=$|[\s"'|&;<>()])/g;
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

const ALLOWED_UNIX = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);

/** The references outside the workspace found in the command, as written.
    Empty when the command stays inside. */
export function findOutsideReferences(command: string, workspace: string): string[] {
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
    if (!p || ALLOWED_UNIX.has(p)) continue;
    /* On Windows, `/c/Users/…` is the C: drive as seen from Git bash and the
       other roots (`/usr`, `/tmp`) are outside the folder by construction.
       On macOS/Linux, it is simply an absolute path: it is compared to the
       folder, otherwise every absolute path INSIDE the folder would be refused. */
    const drive = process.platform === "win32" ? p.match(/^\/([A-Za-z])\/(.*)$/) : null;
    const resolved = process.platform !== "win32" ? path.resolve(p) : drive ? path.resolve(`${drive[1]}:/${drive[2]}`) : null;
    if (!resolved || !isInside(workspace, resolved)) push(p);
  }
  for (const m of command.matchAll(RELATIVE_UP)) {
    const p = m[1];
    if (p && !isInside(workspace, path.resolve(workspace, p))) push(p);
  }
  for (const m of command.matchAll(HOME)) {
    if (m[1]) push(m[1]);
  }
  for (const m of command.matchAll(WIN_ROOT)) {
    if (m[1]) push(m[1]);
  }
  return out;
}

export function outsideMessage(refs: string[]): string {
  return (
    `Command refused: it references a location outside the workspace (${refs.map((r) => `"${r}"`).join(", ")}). ` +
    "This agent's scope is limited to its workspace; work with relative paths inside it, or ask the user to widen the scope to the whole disk in the agent's settings."
  );
}
