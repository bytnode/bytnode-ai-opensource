import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------------------
   Paths, and the scope.

   A relative path resolves inside the agent's workspace. What happens to a
   path that leaves it depends on the agent's SCOPE:
     - `workspace`: refused. The agent neither reads nor writes anything outside.
     - `disk`     : accepted. The whole disk, like a development tool.
   The comparison ignores `..`, misleading prefixes (`/work` versus
   `/work2`) and, on Windows, letter case.

   ⚠️ THIS SCOPE ONLY APPLIES TO THE FILE TOOLS. A shell starts in the
   workspace but nothing stops it from leaving — the model is told so, and
   it is the "ask before acting" mode that protects there.
--------------------------------------------------------------------------- */

export type Scope = "workspace" | "disk";

export class OutsideWorkspaceError extends Error {
  constructor(public readonly requested: string) {
    super(`Path outside the workspace: ${requested}. This agent's scope is limited to its workspace.`);
    this.name = "OutsideWorkspaceError";
  }
}

/* Windows and macOS disks ignore letter case (APFS by default). */
const norm = (p: string) => (process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p);

export function isInside(workspace: string, absolute: string): boolean {
  const rel = path.relative(norm(path.resolve(workspace)), norm(absolute));
  /* A `..` SEGMENT climbs out; a name that merely starts with dots
     (`..notes.md`) is a file inside. */
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** `~` is the user's folder, as in every shell: `~/Desktop/x.md` used to
    become a folder literally named `~` inside the workspace. */
export function expandHome(p: string, home = os.homedir()): string {
  return p === "~" ? home : /^~[\\/]/.test(p) ? path.join(home, p.slice(2)) : p;
}

export function resolvePath(workspace: string, requested: string, scope: Scope = "workspace"): string {
  const target = path.resolve(workspace, expandHome(requested));
  if (scope === "workspace" && !isInside(workspace, target)) throw new OutsideWorkspaceError(requested);
  return target;
}

/** The path as it is shown: relative to the workspace when it sits inside,
    absolute otherwise. Always with forward slashes. */
export function displayPath(workspace: string, absolute: string): string {
  const rel = path.relative(workspace, absolute);
  if (rel === "") return ".";
  return (isInside(workspace, absolute) ? rel : absolute).split(path.sep).join("/");
}
