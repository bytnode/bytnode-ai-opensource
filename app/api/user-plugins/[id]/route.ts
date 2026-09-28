import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { readPluginReviewNotices } from "@/lib/plugins/core/notifications";
import { readyRuntime } from "@/lib/plugins/host";
import { removeUserPlugin, revoke, userPluginIds } from "@/lib/plugins/user/files";
import { isUserPluginId } from "@/lib/plugins/user/manifest";

/* One plugin written by an agent, from the library:
   - POST { action: "revoke" }: it stops for good — what ran and what was
     granted go, the draft stays (an agent may activate it again; the user
     reviews it again);
   - DELETE (?data=1): it is deleted, its data too if asked. */

type Params = { params: Promise<{ id: string }> };

/** A well-formed id is not yet a plugin: one that has no folder is unknown. */
const known = async (id: string) => isUserPluginId(id) && (await userPluginIds()).includes(id);

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await known(id))) return Response.json({ error: { message: `Unknown plugin: ${id}` } }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "revoke") return Response.json({ error: { message: 'Expected { action: "revoke" }.' } }, { status: 400 });
  await readyRuntime();
  await revoke(id);
  await readPluginReviewNotices(id);
  await reloadUserPlugins();
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await known(id))) return Response.json({ error: { message: `Unknown plugin: ${id}` } }, { status: 404 });
  await readyRuntime();
  await revoke(id);
  await reloadUserPlugins();
  await removeUserPlugin(id, new URL(req.url).searchParams.get("data") === "1");
  await readPluginReviewNotices(id);
  return Response.json({ ok: true });
}
