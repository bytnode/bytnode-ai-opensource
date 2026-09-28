import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expandHome } from "@/lib/tools/paths";
import { workspacesDir } from "./data-dir";

/* An agent's workspace: the one it configured, or else
   `~/.bytnode-ai/workspaces/<id>`. Created if missing. The old locations
   inside the project (`workspaces/<id>`, then `sandboxes/<id>`, whose name
   promised an isolation the "whole disk" scope did not honor) are moved
   once: the package installed by npx is replaced at every version, nothing
   of the user's should remain there. */

export const PROJECT_ROOT = process.cwd();

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Moves a folder, including across volumes (copy then delete). */
async function move(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/** A workspace that cannot be used: said to the caller, never a bare 500. */
export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/** The route's answer when `resolveWorkspace` failed. */
export function workspaceError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  return Response.json({ error: { message } }, { status: e instanceof WorkspaceError ? 400 : 500 });
}

/** An agent id as a folder name: no separator, and never `.` / `..` (the
    workspaces root, or the data folder itself — where a plugin's
    `grant.json` lives). */
export const safeAgentId = (agentId: string) => (agentId || "agent").replace(/[^\w.-]/g, "_").replace(/^\.+/, "_");

/* ⚠️ A NETWORK FOLDER IS NEVER A WORKSPACE. `\\host\share` makes the
   server open an SMB connection — on Windows that sends the user's NTLM
   hash to whatever host the path names — and every file tool would then
   work across the network. `\\?\` device paths go with it. */
const UNC = /^[\\/]{2}/;

type ResolveOptions = {
  /** Create the folder when it is missing (default). A read-only caller
      (`GET /api/files`) passes `false`: a GET never creates folders. */
  create?: boolean;
};

export async function resolveWorkspace(agentId: string, requested: string | undefined, opts: ResolveOptions = {}): Promise<string> {
  const create = opts.create ?? true;
  const safeId = safeAgentId(agentId);
  const wanted = requested?.trim() ?? "";
  /* `.` or `./` would be the user's home (relative paths resolve there):
     whoever typed it meant "the default". */
  if (wanted && !/^\.[\\/]?$/.test(wanted)) {
    if (UNC.test(wanted)) throw new WorkspaceError(`A network folder cannot be a workspace (${wanted}). Choose a folder on this computer.`);
    /* `~/Projects/desk` (how a macOS / Linux user types it) and a relative
       path are the user's folder's: resolved against the server's cwd —
       the npm package — they landed inside the app, wiped at the next
       update. */
    const dir = path.resolve(os.homedir(), expandHome(wanted));
    if (UNC.test(dir)) throw new WorkspaceError(`A network folder cannot be a workspace (${wanted}). Choose a folder on this computer.`);
    if (create) await makeDir(dir);
    return dir;
  }
  const dir = path.join(workspacesDir(), safeId);
  if (!create) return dir;
  if (!(await exists(dir))) {
    for (const legacy of [path.join(PROJECT_ROOT, "workspaces", safeId), path.join(PROJECT_ROOT, "sandboxes", safeId)]) {
      if (await exists(legacy)) {
        await move(legacy, dir);
        break;
      }
    }
  }
  await makeDir(dir);
  return dir;
}

async function makeDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    throw new WorkspaceError(`The workspace folder ${dir} cannot be created: ${e instanceof Error ? e.message : String(e)}`);
  }
}
