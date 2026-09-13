"use client";

import type { Attachment } from "./attachments";
import { captureScreen, downscaleToJpeg, toBase64 } from "./capture";

/* Ce que le navigateur fait pour joindre quelque chose : reduire les images,
   deposer les fichiers dans le dossier de travail de l'agent par la route, et
   rendre les pieces jointes pretes a etre envoyees. */

type Cible = { agentId: string; workspace: string };

async function deposer(cible: Cible, fichiers: Array<{ name: string; blob: Blob; type?: string }>): Promise<Attachment[]> {
  const files = await Promise.all(
    fichiers.map(async (f) => ({ name: f.name, type: f.type ?? f.blob.type, content: await toBase64(f.blob) })),
  );
  const res = await fetch("/api/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: cible.agentId, workspace: cible.workspace, files }),
  });
  const json = (await res.json()) as { attachments?: Attachment[]; error?: { message?: string } };
  if (!res.ok || !json.attachments) throw new Error(json.error?.message ?? `Le dépôt a échoué (${res.status}).`);
  return json.attachments;
}

const IMAGE = /^image\//;

/** Des fichiers choisis : l'original part sur le disque ; une version reduite
    sert d'apercu et de ce que le modele voit. */
export async function attachFiles(cible: Cible, liste: FileList | File[]): Promise<Attachment[]> {
  const fichiers = Array.from(liste);
  if (fichiers.length === 0) return [];
  const depose = await deposer(
    cible,
    fichiers.map((f) => ({ name: f.name, blob: f, type: f.type })),
  );
  /* Pour les images, on remplace l'apercu du serveur par une version reduite
     cote navigateur : le fil vit dans `localStorage`. */
  return Promise.all(
    depose.map(async (a, i) => {
      const source = fichiers[i];
      if (a.kind !== "image" || !source || !IMAGE.test(source.type)) return a;
      const petit = await downscaleToJpeg(source);
      if (!petit) return a;
      return { ...a, dataUrl: `data:image/jpeg;base64,${await toBase64(petit)}` };
    }),
  );
}

/** Une capture d'ecran : le navigateur demande quoi partager, l'image reduite
    est deposee dans le dossier de travail. */
export async function attachScreenshot(cible: Cible): Promise<Attachment[]> {
  const { name, blob } = await captureScreen();
  const [a] = await deposer(cible, [{ name, blob, type: "image/jpeg" }]);
  return a ? [{ ...a, dataUrl: `data:image/jpeg;base64,${await toBase64(blob)}` }] : [];
}
