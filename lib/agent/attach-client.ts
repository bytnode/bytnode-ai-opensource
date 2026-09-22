"use client";

import type { Attachment } from "./attachments";
import { captureScreen, downscaleToJpeg, toBase64 } from "./capture";

/* What the browser does to attach something: shrink images, drop the files
   into the agent's workspace through the route, and make the attachments
   ready to be sent. */

type Target = { agentId: string; workspace: string };

async function upload(target: Target, files: Array<{ name: string; blob: Blob; type?: string }>): Promise<Attachment[]> {
  const encoded = await Promise.all(
    files.map(async (f) => ({ name: f.name, type: f.type ?? f.blob.type, content: await toBase64(f.blob) })),
  );
  const res = await fetch("/api/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: target.agentId, workspace: target.workspace, files: encoded }),
  });
  const json = (await res.json()) as { attachments?: Attachment[]; error?: { message?: string } };
  if (!res.ok || !json.attachments) throw new Error(json.error?.message ?? `Upload failed (${res.status}).`);
  return json.attachments;
}

const IMAGE = /^image\//;

/** Chosen files: the original goes to disk; a downscaled version serves as
    the preview and as what the model sees. */
export async function attachFiles(target: Target, list: FileList | File[]): Promise<Attachment[]> {
  const files = Array.from(list);
  if (files.length === 0) return [];
  const uploaded = await upload(
    target,
    files.map((f) => ({ name: f.name, blob: f, type: f.type })),
  );
  /* For images, the server's preview is replaced by a version downscaled in
     the browser: the thread lives in `localStorage`. */
  return Promise.all(
    uploaded.map(async (a, i) => {
      const source = files[i];
      if (a.kind !== "image" || !source || !IMAGE.test(source.type)) return a;
      const small = await downscaleToJpeg(source);
      if (!small) return a;
      return { ...a, dataUrl: `data:image/jpeg;base64,${await toBase64(small)}` };
    }),
  );
}

/** A screenshot: the browser asks what to share, and the downscaled image
    is dropped into the workspace. */
export async function attachScreenshot(target: Target): Promise<Attachment[]> {
  const { name, blob } = await captureScreen();
  const [a] = await upload(target, [{ name, blob, type: "image/jpeg" }]);
  return a ? [{ ...a, dataUrl: `data:image/jpeg;base64,${await toBase64(blob)}` }] : [];
}
