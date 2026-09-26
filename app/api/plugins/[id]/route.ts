import { pluginManifest } from "@/lib/plugins/catalog";
import { readyRuntime } from "@/lib/plugins/host";

/* "Clear the data" in the library: the plugin stops, its folder in
   `~/.bytnode-ai/plugins/` is deleted, it starts again empty. The browser
   asked for a confirmation first. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runtime = await readyRuntime();
  if (!pluginManifest(id) && !runtime.manifests.some((m) => m.id === id)) return Response.json({ error: { message: `Unknown plugin: ${id}` } }, { status: 404 });
  await runtime.clearData(id);
  return Response.json({ ok: true });
}
