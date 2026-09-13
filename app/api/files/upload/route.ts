import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "@/lib/server/workspace";
import { isImageName, safeFileName, type Attachment } from "@/lib/agent/attachments";

/* ---------------------------------------------------------------------------
   Deposer des fichiers dans le dossier de travail de l'agent.

   Le navigateur ne peut pas ecrire sur le disque ; il envoie donc le contenu
   en base64 et c'est le serveur — qui tourne sur la machine de
   l'utilisateur — qui ecrit, dans `entrees/` du dossier de travail. L'agent
   les lit ensuite avec ses outils, comme n'importe quel fichier : rien ne
   passe par le contexte du modele, sauf les images.

   Le nom est assaini (`safeFileName`) et le chemin final verifie : un nom
   ne doit jamais faire sortir du dossier.
--------------------------------------------------------------------------- */

const ENTREES = "entrees";
const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
/** Ce qu'on montre au modele : au-dela, l'image reste sur le disque mais
    n'est pas jointe au message (le fil vit dans localStorage). */
const MAX_INLINE_IMAGE = 700 * 1024;

type Entree = { name?: unknown; content?: unknown; type?: unknown };

export async function POST(req: Request) {
  let body: { agentId?: string; workspace?: string; files?: Entree[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Corps de requête illisible." } }, { status: 400 });
  }
  const entrees = Array.isArray(body.files) ? body.files : [];
  if (entrees.length === 0) return Response.json({ error: { message: "Aucun fichier." } }, { status: 400 });

  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace ?? "");
  const dir = path.join(workspace, ENTREES);
  await fs.mkdir(dir, { recursive: true });

  const out: Attachment[] = [];
  let total = 0;
  for (const e of entrees) {
    if (typeof e.name !== "string" || typeof e.content !== "string") continue;
    const buf = Buffer.from(e.content, "base64");
    if (buf.length === 0) continue;
    if (buf.length > MAX_FILE) return Response.json({ error: { message: `${e.name} dépasse 25 Mo.` } }, { status: 413 });
    total += buf.length;
    if (total > MAX_TOTAL) return Response.json({ error: { message: "Plus de 60 Mo en une fois : envoyez-les en plusieurs fois." } }, { status: 413 });

    const name = uniqueName(dir, safeFileName(e.name), out);
    const target = path.join(dir, name);
    if (path.dirname(path.resolve(target)) !== path.resolve(dir)) {
      return Response.json({ error: { message: "Nom de fichier refusé." } }, { status: 400 });
    }
    await fs.writeFile(target, buf);
    const image = isImageName(name);
    out.push({
      name,
      path: `${ENTREES}/${name}`,
      kind: image ? "image" : "file",
      size: buf.length,
      ...(image && buf.length <= MAX_INLINE_IMAGE
        ? { dataUrl: `data:${typeof e.type === "string" && e.type.startsWith("image/") ? e.type : "image/png"};base64,${buf.toString("base64")}` }
        : {}),
    });
  }
  if (out.length === 0) return Response.json({ error: { message: "Rien à enregistrer." } }, { status: 400 });
  return Response.json({ workspace, attachments: out });
}

/** Ne pas ecraser : `donnees.csv`, `donnees-2.csv`… */
function uniqueName(dir: string, name: string, deja: Attachment[]): string {
  const prises = new Set(deja.map((a) => a.name));
  if (!prises.has(name)) return name;
  const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const base = m?.[1] ?? name;
  const ext = m?.[2] ?? "";
  for (let i = 2; i < 500; i++) {
    const essai = `${base}-${i}${ext}`;
    if (!prises.has(essai)) return essai;
  }
  return `${base}-${Date.now().toString(36)}${ext}`;
}
