import { appendLog, readGrant } from "@/lib/plugins/user/files";
import { isUserPluginId } from "@/lib/plugins/user/manifest";

/* What the page of a plugin written by an agent reported (an exception, an
   action that failed), relayed by its tab: kept in the plugin's log for
   the agent's next PluginCheck. Bounded, text only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserPluginId(id) || !(await readGrant(id))) return Response.json({ error: { message: "Unknown plugin." } }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.slice(0, 800) : "";
  if (message) await appendLog(id, { source: "view", level: "error", message });
  return Response.json({ ok: true });
}
