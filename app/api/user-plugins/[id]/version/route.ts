import { readGrant } from "@/lib/plugins/user/files";
import { isUserPluginId } from "@/lib/plugins/user/manifest";

/* Which version of a plugin written by an agent runs (its grant's date):
   its open tab asks every 2 s and reloads on a new one — an agent's change
   shows live. A few bytes, one small file read. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserPluginId(id)) return Response.json({ at: "" }, { status: 404 });
  return Response.json({ at: (await readGrant(id))?.at ?? "" });
}
