import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { readPluginReviewNotices } from "@/lib/plugins/core/notifications";
import { pluginHost, readyRuntime } from "@/lib/plugins/host";
import { activate, clearRequest, readRequest } from "@/lib/plugins/user/files";
import { isUserPluginId } from "@/lib/plugins/user/manifest";

/* ---------------------------------------------------------------------------
   The user's decision on a plugin written by an agent: its permissions
   granted (with the exchange accounts they ticked) or refused.

   ⚠️ ONLY THE REVIEW SCREEN COMES HERE. What is granted is the request's
   permissions, never the body's; the `digest` the screen showed must still
   be the request's, and the files the draft's (`activate` checks it) — a
   plugin changed after the user looked at it is refused. A request that
   does not come from the app's own page (`Sec-Fetch-Site`) is refused: an
   agent's script calling this URL is not the user clicking.
   ⚠️ Limit, as for any local app: a process running as the user can forge
   headers. The review keeps an honest agent — and a plugin — from
   granting itself anything; it is not a wall against the user's own shell.
--------------------------------------------------------------------------- */

type Body = { digest?: unknown; allow?: unknown; accounts?: unknown };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserPluginId(id)) return Response.json({ error: { message: `Unknown plugin: ${id}` } }, { status: 404 });
  if (req.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: { message: "A plugin is approved from BytNode-AI's review screen only." } }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Body;
  await readyRuntime();
  const request = await readRequest(id);
  if (!request) return Response.json({ error: { message: "Nothing waits for approval: it was already decided." } }, { status: 409 });
  if (body.digest !== request.digest) return Response.json({ error: { message: "The plugin changed since this screen opened: close it and review it again." } }, { status: 409 });

  if (body.allow !== true) {
    await clearRequest(id);
    await readPluginReviewNotices(id);
    return Response.json({ ok: true, state: "refused" });
  }

  /* The accounts: among the ones this app knows, when a tab spoke. */
  const known = pluginHost().session.get()?.exchangeAccounts.map((a) => a.id);
  const ticked = Array.isArray(body.accounts) ? body.accounts.filter((a): a is string => typeof a === "string") : [];
  const accounts = request.permissions.exchange === "none" ? [] : ticked.filter((a) => !known || known.includes(a));
  if (request.permissions.exchange !== "none" && accounts.length === 0) return Response.json({ error: { message: "Choose at least one exchange account for it, or refuse." } }, { status: 400 });
  try {
    await activate(id, { permissions: request.permissions, accounts, digest: request.digest, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 409 });
  }
  await readPluginReviewNotices(id);
  await reloadUserPlugins();
  return Response.json({ ok: true, state: "active" });
}
