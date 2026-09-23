import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "@/lib/server/workspace";
import { isInside } from "@/lib/tools/paths";

/* A file from an agent's workspace, for the thread: the images produced by
   Chart and Backtest, or read by Read, and the reports exported as HTML.
   Never outside the workspace, whatever the agent's scope. */

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
  /* A report (report-export): the sandbox below keeps it inert — no
     script, nothing loaded from outside, only its inline style and images. */
  ".html": "text/html; charset=utf-8",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const requested = url.searchParams.get("path") ?? "";
  if (!requested) return new Response("missing path", { status: 400 });
  const workspace = await resolveWorkspace(agentId, url.searchParams.get("workspace") ?? "");
  const target = path.resolve(workspace, requested);
  if (!isInside(workspace, target)) return new Response("outside the workspace", { status: 403 });
  const type = TYPES[path.extname(target).toLowerCase()];
  if (!type) return new Response("type not served", { status: 415 });
  try {
    const buf = await fs.readFile(target);
    /* Served from the application's origin, where the keys live: an SVG (or
       a disguised file) written by an agent must not be able to run script
       there if it is opened in a tab. */
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": type,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
