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

export async function resolveWorkspace(agentId: string, requested: string | undefined): Promise<string> {
  const safeId = (agentId || "agent").replace(/[^\w.-]/g, "_");
  if (requested?.trim()) {
    /* `~/Projects/desk` (how a macOS / Linux user types it) and a relative
       path are the user's folder's: resolved against the server's cwd —
       the npm package — they landed inside the app, wiped at the next
       update. */
    const dir = path.resolve(os.homedir(), expandHome(requested.trim()));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(workspacesDir(), safeId);
  if (!(await exists(dir))) {
    for (const legacy of [path.join(PROJECT_ROOT, "workspaces", safeId), path.join(PROJECT_ROOT, "sandboxes", safeId)]) {
      if (await exists(legacy)) {
        await move(legacy, dir);
        break;
      }
    }
  }
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
