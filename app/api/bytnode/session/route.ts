import { isMainSecret, MAIN_HEADER, setAccountSession } from "@/lib/bytnode/app-pass";

/* The desktop app's main process hands this server the app's BytNode
   credential, derived from the account session it keeps (`desktop/main.ts`,
   `lib/bytnode/engine-credential.ts`); `{ token: null }` when signed out. It
   proves itself with the secret it started this server with
   (`BYTNODE_AI_MAIN_SECRET`): the page never sees it, and the session itself
   never reaches this server. */
export async function POST(req: Request) {
  if (!isMainSecret(req.headers.get(MAIN_HEADER))) return Response.json({ message: "Refused." }, { status: 403 });
  let token: unknown = null;
  try {
    token = ((await req.json()) as { token?: unknown } | null)?.token ?? null;
  } catch {
    return Response.json({ message: "Unreadable request body." }, { status: 400 });
  }
  setAccountSession("main", typeof token === "string" ? token : null);
  return new Response(null, { status: 204 });
}
