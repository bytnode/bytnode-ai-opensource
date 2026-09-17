import fs from "node:fs/promises";
import path from "node:path";
import { workspacesDir } from "@/lib/server/data-dir";
import type { AcpAgentId } from "./agents";

/* Preparer un dossier de travail pour un agent par abonnement.

   Claude Code lit les reglages de l'utilisateur (`~/.claude/settings.json`)
   et l'adaptateur ACP refuse un `permissions.defaultMode` qu'il ne connait
   pas (« auto », par exemple, plus recent que lui). Les reglages LOCAUX du
   dossier (`.claude/settings.local.json`) priment sur ceux de l'utilisateur :
   on y fixe le mode `default`, celui ou chaque action passe par notre
   demande de permission. On ne touche a rien d'autre dans ce fichier. */

const KNOWN_MODES = new Set(["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"]);

export async function prepareWorkspace(agent: AcpAgentId, cwd: string): Promise<void> {
  if (agent !== "claude") return;
  const dir = path.join(cwd, ".claude");
  const file = path.join(dir, "settings.local.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* absent ou illisible : on repart de zero */
  }
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  if (typeof permissions.defaultMode === "string" && KNOWN_MODES.has(permissions.defaultMode)) return;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...settings, permissions: { ...permissions, defaultMode: "default" } }, null, 2) + "\n");
}

/** Un dossier neutre, a nous, pour les sessions jetables (decouverte des
    modeles). */
export async function scratchWorkspace(): Promise<string> {
  const dir = path.join(workspacesDir(), "_acp");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
