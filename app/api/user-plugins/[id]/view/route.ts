import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "@/lib/server/workspace";
import { readFiles, readGrant } from "@/lib/plugins/user/files";
import { isUserPluginId } from "@/lib/plugins/user/manifest";
import { composeView, VIEW_CSP } from "@/lib/plugins/user/view";

/* The page of a plugin written by an agent — the APPROVED version only —
   as one document with the BytNode kit, under a CSP that gives it no
   network and an origin of its own (`lib/plugins/user/view.ts`). Loaded
   by the tab's frame (`components/plugins/user-view.tsx`). */

let kit: Promise<{ css: string; js: string }> | null = null;

/** The kit, read once in production; at every request in development. */
function readKit(): Promise<{ css: string; js: string }> {
  if (kit && process.env.NODE_ENV === "production") return kit;
  const dir = path.join(PROJECT_ROOT, "lib", "plugins", "user", "kit");
  kit = Promise.all([fs.readFile(path.join(dir, "kit.css"), "utf8"), fs.readFile(path.join(dir, "kit.js"), "utf8")]).then(([css, js]) => ({ css, js }));
  kit.catch(() => (kit = null));
  return kit;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserPluginId(id) || !(await readGrant(id))) return new Response("This plugin is not active.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const files = await readFiles(id, "active");
  const theme = new URL(req.url).searchParams.get("theme") === "light" ? "light" : "dark";
  const html = composeView(files, await readKit(), theme);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": VIEW_CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
