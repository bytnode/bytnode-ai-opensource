"use client";

/* ---------------------------------------------------------------------------
   Capture the screen, and downscale an image, in the browser.

   ⚠️ THE CAPTURE IS NOT DONE ON THE SERVER. Photographing the screen in
   PowerShell (`CopyFromScreen`) is the exact pattern of infostealers:
   Windows' antivirus blocks the script before it runs
   (« ScriptContainedMaliciousContent »). The browser, on the other hand,
   has an API made for this — and it is better: the user picks the window
   or screen to share, in a dialog they recognise.

   ⚠️ AND WE DOWNSCALE BEFORE SENDING. A 6,400 px desktop weighs 6 MB; the
   services resize to ~1,600 px on the long edge anyway, and the thread
   lives in `localStorage`. A downscaled JPEG is legible, light, and
   attachable.
--------------------------------------------------------------------------- */

export const LONG_EDGE = 1_600;
const QUALITY = 0.85;

export class CaptureError extends Error {}

const horodatage = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Opens the screen-share picker, takes ONE frame, and closes everything
    right away: nothing keeps being captured afterwards. */
export async function captureScreen(): Promise<{ name: string; blob: Blob }> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError("This browser cannot capture the screen.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  } catch (e) {
    /* The user closed the dialog: that is not an error. */
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new CaptureError("");
    throw new CaptureError(e instanceof Error ? e.message : String(e));
  }
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    /* A black frame comes out if we draw before the first frame. */
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new CaptureError("The shared screen rendered nothing.");
    const blob = await drawToJpeg(video, w, h);
    video.pause();
    video.srcObject = null;
    return { name: `capture-${horodatage()}.jpg`, blob };
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

/** An image (chosen file, or capture) brought down to `maxEdge` on the long
    edge, as JPEG. Returns `null` if the source is not a readable image. */
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
  if (!ctx) throw new CaptureError("Could not prepare the image.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  if (!blob) throw new CaptureError("Could not encode the image.");
  return blob;
}

/** A file's content in base64, for the upload route. */
export async function toBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
