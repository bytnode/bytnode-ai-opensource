import fs from "node:fs/promises";
import path from "node:path";
import { workspacesDir } from "./data-dir";

/* Le dossier de travail d'un agent : celui qu'il a configure, sinon
   `~/.bytnode-ai/workspaces/<id>`. Cree s'il manque. Les anciens
   emplacements dans le projet (`workspaces/<id>`, puis `sandboxes/<id>`,
   dont le mot promettait une isolation que le perimetre « tout le disque »
   ne tenait pas) sont deplaces une fois : le paquet installe par npx est
   remplace a chaque version, rien de l'utilisateur ne doit y rester. */

export const PROJECT_ROOT = process.cwd();

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Deplace un dossier, y compris d'un volume a l'autre (copie puis suppression). */
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
    const dir = path.resolve(requested.trim());
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
