import { normalizeSettings } from "@/lib/storage/repositories";
import { readyRuntime, syncSession } from "@/lib/plugins/host";
import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { approvalKey } from "@/lib/plugins/user/approval";
import { rememberOrigin, SESSION_HEADER, setAccountSession } from "@/lib/bytnode/app-pass";
import { selfOrigin } from "@/lib/server/origin";

/* ---------------------------------------------------------------------------
   The open tab speaks: its settings, for the background.

   Sent when the app loads, when the settings change and every minute. The
   server keeps the keys IN MEMORY for as long as a tab speaks (they never
   touch the disk: `lib/plugins/core/session.ts`), applies the plugins'
   state, and answers with where each plugin stands.

   ⚠️ THE TAB PROVES ITSELF with its approval key (`x-bytnode-approval`,
   `lib/plugins/user/approval.ts`): the first one received after the server
   starts is registered, and while it is alive a request without it — or
   with another — is refused. Otherwise an agent's script could hand the
   background its own settings (accounts, keys).

   In a browser, the tab also hands its BytNode account session
   (`x-bytnode-session`): the server derives the app's BytNode credential
   from it and keeps only that (`lib/bytnode/app-pass.ts`). The desktop
   app's tab has none — its main process hands the credential over.
--------------------------------------------------------------------------- */
export async function POST(req: Request) {
  const holder = approvalKey();
  const had = holder.current();
  if (!holder.register(req.headers.get("x-bytnode-approval") ?? "")) {
    return Response.json({ error: { message: "Refused: this request does not come from the BytNode-AI tab that is open." } }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const s = normalizeSettings(raw);
  setAccountSession("page", req.headers.get(SESSION_HEADER));
  rememberOrigin(selfOrigin(req.url));
  await syncSession({
    openrouterKey: s.keys.openrouter,
    bytnodeKey: s.keys.bytnode,
    exchangeAccounts: s.keys.exchanges,
    telegramBots: s.keys.telegram,
    agents: s.agents,
    profile: s.profile,
    plugins: s.plugins,
  });
  /* A new key: which approvals verify changed — the plugins are re-read. */
  if (had !== holder.current()) await reloadUserPlugins();
  const runtime = await readyRuntime();
  return Response.json({ status: runtime.status() });
}
