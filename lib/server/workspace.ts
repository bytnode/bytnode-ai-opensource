import fs from "node:fs/promises";
import path from "node:path";

/* Le dossier de travail d'un agent : celui qu'il a configure, sinon
   `workspaces/<id>` dans le projet. Cree s'il manque. L'ancien nom
   `sandboxes/` est repris s'il existe encore : le mot promettait une
   isolation que le perimetre « tout le disque » ne tenait pas. */

export const PROJECT_ROOT = process.cwd();

export async function resolveWorkspace(agentId: string, requested: string | undefined): Promise<string> {
  const safeId = (agentId || "agent").replace(/[^\w.-]/g, "_");
  if (requested?.trim()) {
    const dir = path.resolve(requested.trim());
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(PROJECT_ROOT, "workspaces", safeId);
  const legacy = path.join(PROJECT_ROOT, "sandboxes", safeId);
  try {
    await fs.access(dir);
  } catch {
    try {
      await fs.access(legacy);
      await fs.mkdir(path.dirname(dir), { recursive: true });
      await fs.rename(legacy, dir);
    } catch {
      /* pas d'ancien dossier : on cree le nouveau */
    }
  }
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
