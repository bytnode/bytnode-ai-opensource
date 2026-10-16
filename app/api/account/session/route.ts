import { accountUrls } from "@/lib/account/flow";
import { readMe, revokeSession } from "@/lib/account/sign-in";

/* The BytNode account session of the app in a browser, which the page keeps
   and sends in `x-bytnode-session`: GET says whether bytnode.com still
   takes it (and the account as it is now), DELETE revokes it. */

const tokenOf = (req: Request) => req.headers.get("x-bytnode-session")?.trim() ?? "";

export async function GET(req: Request) {
  const token = tokenOf(req);
  if (!token) return Response.json({ kind: "revoked", message: "Not signed in." });
  return Response.json(await readMe(accountUrls(process.env), token));
}

export async function DELETE(req: Request) {
  const token = tokenOf(req);
  if (token) await revokeSession(accountUrls(process.env), token);
  return new Response(null, { status: 204 });
}
