import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { readPluginReviewNotices } from "@/lib/plugins/core/notifications";
import { pluginHost, readyRuntime } from "@/lib/plugins/host";
import { activate, appendLog, clearRequest, readGrant, readRequest } from "@/lib/plugins/user/files";
import { approvalKey, isTrustedGrant, signGrant } from "@/lib/plugins/user/approval";
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
   ⚠️ HEADERS CAN BE FORGED by any local process — an agent's shell got
   `{"state":"active"}` that way. What it cannot forge is the approval key
   only the user's browser holds (`x-bytnode-approval`,
   `lib/plugins/user/approval.ts`): required here, and the grant is SIGNED
   with it — a grant.json written by hand does not run.
--------------------------------------------------------------------------- */

type Body = { digest?: unknown; allow?: unknown; accounts?: unknown };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserPluginId(id)) return Response.json({ error: { message: `Unknown plugin: ${id}` } }, { status: 404 });
  /* A browser's POST from the app's page carries both; a bare script
     usually neither (the proxy already refuses a foreign Origin). */
  if (req.headers.get("sec-fetch-site") !== "same-origin" || !req.headers.get("origin")) return Response.json({ error: { message: "A plugin is approved from BytNode-AI's review screen only." } }, { status: 403 });
  const holder = approvalKey();
  const key = holder.current();
  if (!key || !holder.matches(req.headers.get("x-bytnode-approval"))) {
    return Response.json({ error: { message: "A plugin is approved from the BytNode-AI tab only: reload the app's page and try again." } }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  await readyRuntime();
  const request = await readRequest(id);
  if (!request) {
    /* An approval given before the lock (unsigned): the user approves the
       SAME grant again from its review, and it is signed. */
    const grant = await readGrant(id);
    if (grant && body.allow === true && body.digest === grant.digest && !isTrustedGrant(id, grant)) {
      await activate(id, { ...grant, at: new Date().toISOString(), sig: signGrant(key, id, grant) });
      await appendLog(id, { source: "log", level: "info", message: "Approved again (signed approval)." }).catch(() => {});
      await reloadUserPlugins();
      return Response.json({ ok: true, state: "active" });
    }
    return Response.json({ error: { message: "Nothing waits for approval: it was already decided." } }, { status: 409 });
  }
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
    await activate(id, { permissions: request.permissions, accounts, digest: request.digest, at: new Date().toISOString(), sig: signGrant(key, id, { permissions: request.permissions, accounts }) });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 409 });
  }
  /* A trace the user can read in the plugin's page: who approved, from what. */
  await appendLog(id, { source: "log", level: "info", message: `Approved (${request.permissions.exchange === "none" ? "no exchange account" : `accounts: ${accounts.join(", ")}`}) from ${req.headers.get("user-agent")?.slice(0, 120) ?? "an unknown client"}.` }).catch(() => {});
  await readPluginReviewNotices(id);
  await reloadUserPlugins();
  return Response.json({ ok: true, state: "active" });
}
