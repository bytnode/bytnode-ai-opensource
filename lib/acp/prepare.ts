import fs from "node:fs/promises";
import path from "node:path";
import { workspacesDir } from "@/lib/server/data-dir";
import type { AcpAgentId } from "./agents";

/* Prepare a workspace for a subscription agent.

   Claude Code reads the user's settings (`~/.claude/settings.json`) and
   the ACP adapter rejects a `permissions.defaultMode` it does not know
   (« auto », for instance, newer than it is). The folder's LOCAL settings
   (`.claude/settings.local.json`) take precedence over the user's: we set
   the `default` mode there, the one where every action goes through our
   permission prompt. We touch nothing else in that file. */

const KNOWN_MODES = new Set(["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"]);

export async function prepareWorkspace(agent: AcpAgentId, cwd: string): Promise<void> {
  if (agent !== "claude") return;
  const dir = path.join(cwd, ".claude");
  const file = path.join(dir, "settings.local.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* absent or unreadable: start from scratch */
  }
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  if (typeof permissions.defaultMode === "string" && KNOWN_MODES.has(permissions.defaultMode)) return;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...settings, permissions: { ...permissions, defaultMode: "default" } }, null, 2) + "\n");
}

/** A neutral folder of our own, for throwaway sessions (model
    discovery). */
export async function scratchWorkspace(): Promise<string> {
  const dir = path.join(workspacesDir(), "_acp");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
