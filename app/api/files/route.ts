import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "@/lib/server/workspace";
import { isInside } from "@/lib/tools/paths";

/* Un fichier du dossier de travail d'un agent, pour le fil : les images
   produites par Chart et Backtest, ou lues par Read. Jamais hors du dossier
   de travail, quel que soit le perimetre de l'agent. */

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const requested = url.searchParams.get("path") ?? "";
  if (!requested) return new Response("path manquant", { status: 400 });
  const workspace = await resolveWorkspace(agentId, url.searchParams.get("workspace") ?? "");
  const target = path.resolve(workspace, requested);
  if (!isInside(workspace, target)) return new Response("hors du dossier de travail", { status: 403 });
  const type = TYPES[path.extname(target).toLowerCase()];
  if (!type) return new Response("type non servi", { status: 415 });
  try {
    const buf = await fs.readFile(target);
    return new Response(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "no-cache" } });
  } catch {
    return new Response("introuvable", { status: 404 });
  }
}
