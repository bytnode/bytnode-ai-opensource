import { normalizeSettings } from "@/lib/storage/repositories";
import { readyRuntime, syncSession } from "@/lib/plugins/host";

/* ---------------------------------------------------------------------------
   The open tab speaks: its settings, for the background.

   Sent when the app loads, when the settings change and every minute. The
   server keeps the keys IN MEMORY for as long as a tab speaks (they never
   touch the disk: `lib/plugins/core/session.ts`), applies the plugins'
   state, and answers with where each plugin stands.
--------------------------------------------------------------------------- */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: { message: "Unreadable request body." } }, { status: 400 });
  }
  const s = normalizeSettings(raw);
  await syncSession({
    openrouterKey: s.keys.openrouter,
    bytnodeKey: s.keys.bytnode,
    exchangeAccounts: s.keys.exchanges,
    agents: s.agents,
    profile: s.profile,
    plugins: s.plugins,
  });
  const runtime = await readyRuntime();
  return Response.json({ status: runtime.status() });
}
