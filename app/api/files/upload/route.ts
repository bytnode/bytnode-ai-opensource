import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "@/lib/server/workspace";
import { isImageName, safeFileName, type Attachment } from "@/lib/agent/attachments";

/* ---------------------------------------------------------------------------
   Drop files into the agent's workspace.

   The browser cannot write to the disk; so it sends the content in base64
   and the server — which runs on the user's machine — does the writing,
   into `entrees/` in the workspace. The agent then reads them with its
   tools, like any other file: nothing goes through the model's context,
   except the images.

   The name is sanitised (`safeFileName`) and the final path checked: a
   name must never lead outside the folder.
--------------------------------------------------------------------------- */

const ENTREES = "entrees";
const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
/** What we show the model: beyond this, the image stays on the disk but is
    not attached to the message (the thread lives in localStorage). */
const MAX_INLINE_IMAGE = 700 * 1024;

type Entree = { name?: unknown; content?: unknown; type?: unknown };

export async function POST(req: Request) {
  let body: { agentId?: string; workspace?: string; files?: Entree[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const entrees = Array.isArray(body.files) ? body.files : [];
  if (entrees.length === 0) return Response.json({ error: { message: "No file." } }, { status: 400 });

  const workspace = await resolveWorkspace(body.agentId ?? "", body.workspace ?? "");
  const dir = path.join(workspace, ENTREES);
  await fs.mkdir(dir, { recursive: true });

  const out: Attachment[] = [];
  let total = 0;
  for (const e of entrees) {
    if (typeof e.name !== "string" || typeof e.content !== "string") continue;
    const buf = Buffer.from(e.content, "base64");
    if (buf.length === 0) continue;
    if (buf.length > MAX_FILE) return Response.json({ error: { message: `${e.name} exceeds 25 MB.` } }, { status: 413 });
    total += buf.length;
    if (total > MAX_TOTAL) return Response.json({ error: { message: "More than 60 MB at once: send them in several batches." } }, { status: 413 });

    const name = await uniqueName(dir, safeFileName(e.name), out, buf);
    const target = path.join(dir, name);
    if (path.dirname(path.resolve(target)) !== path.resolve(dir)) {
      return Response.json({ error: { message: "File name rejected." } }, { status: 400 });
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
  if (out.length === 0) return Response.json({ error: { message: "Nothing to save." } }, { status: 400 });
  return Response.json({ workspace, attachments: out });
}

/** Never overwrite: `data.csv`, `data-2.csv`… ⚠️ Against the files ALREADY
    on the disk too — re-attaching `data.csv` replaced the one an earlier
    message points to — and without regard to case: Windows and macOS
    disks take `Data.csv` and `data.csv` for one file. The same file sent
    again keeps its name (nothing to protect). */
async function uniqueName(dir: string, name: string, deja: Attachment[], buf: Buffer): Promise<string> {
  const onDisk = new Map((await fs.readdir(dir).catch(() => [] as string[])).map((n) => [n.toLowerCase(), n]));
  const batch = new Set(deja.map((a) => a.name.toLowerCase()));
  const same = async (n: string) => {
    const existing = onDisk.get(n.toLowerCase());
    return existing === n && (await fs.readFile(path.join(dir, n)).catch(() => null))?.equals(buf) === true;
  };
  const free = (n: string) => !batch.has(n.toLowerCase()) && !onDisk.has(n.toLowerCase());
  if (free(name) || (!batch.has(name.toLowerCase()) && (await same(name)))) return name;
  const prises = { has: (n: string) => !free(n) };
  const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const base = m?.[1] ?? name;
  const ext = m?.[2] ?? "";
  for (let i = 2; i < 500; i++) {
    const essai = `${base}-${i}${ext}`;
    if (!prises.has(essai)) return essai;
  }
  return `${base}-${Date.now().toString(36)}${ext}`;
}
