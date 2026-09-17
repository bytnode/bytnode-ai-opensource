"use client";

/* ---------------------------------------------------------------------------
   Capturer l'ecran, et reduire une image, dans le navigateur.

   ⚠️ LA CAPTURE NE SE FAIT PAS SUR LE SERVEUR. Photographier l'ecran en
   PowerShell (`CopyFromScreen`) est le motif exact des voleurs de donnees :
   l'antivirus de Windows bloque le script avant qu'il ne tourne
   (« ScriptContainedMaliciousContent »). Le navigateur, lui, a une API faite
   pour ça — et elle est meilleure : c'est l'utilisateur qui choisit la
   fenetre ou l'ecran a partager, dans un dialogue qu'il reconnait.

   ⚠️ ET ON REDUIT AVANT D'ENVOYER. Un bureau de 6 400 px pese 6 Mo ; les
   services redimensionnent de toute façon vers ~1 600 px de grand cote, et
   le fil vit dans `localStorage`. Un JPEG reduit est lisible, leger, et
   joignable.
--------------------------------------------------------------------------- */

export const LONG_EDGE = 1_600;
const QUALITY = 0.85;

export class CaptureError extends Error {}

const horodatage = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Ouvre le selecteur de partage d'ecran, prend UNE image, et referme tout
    de suite : rien ne continue d'etre capture ensuite. */
export async function captureScreen(): Promise<{ name: string; blob: Blob }> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError("Ce navigateur ne sait pas capturer l'écran.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  } catch (e) {
    /* L'utilisateur a ferme le dialogue : ce n'est pas une erreur. */
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new CaptureError("");
    throw new CaptureError(e instanceof Error ? e.message : String(e));
  }
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    /* Une image noire sort si l'on dessine avant la premiere frame. */
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new CaptureError("L'écran partagé n'a rien rendu.");
    const blob = await drawToJpeg(video, w, h);
    video.pause();
    video.srcObject = null;
    return { name: `capture-${horodatage()}.jpg`, blob };
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

/** Une image (fichier choisi, ou capture) ramenee a `maxEdge` de grand cote,
    en JPEG. Rend `null` si la source n'est pas une image lisible. */
export async function downscaleToJpeg(source: Blob, maxEdge = LONG_EDGE): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source);
    try {
      return await drawToJpeg(bitmap, bitmap.width, bitmap.height, maxEdge);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

async function drawToJpeg(source: CanvasImageSource, w: number, h: number, maxEdge = LONG_EDGE): Promise<Blob> {
  const ratio = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * ratio));
  canvas.height = Math.max(1, Math.round(h * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CaptureError("Impossible de préparer l'image.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  if (!blob) throw new CaptureError("Encodage de l'image impossible.");
  return blob;
}

/** Le contenu d'un fichier en base64, pour la route de dépôt. */
export async function toBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
