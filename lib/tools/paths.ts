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

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export function isInside(workspace: string, absolute: string): boolean {
  const rel = path.relative(norm(path.resolve(workspace)), norm(absolute));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolvePath(workspace: string, requested: string, scope: Scope = "workspace"): string {
  const target = path.resolve(workspace, requested);
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
