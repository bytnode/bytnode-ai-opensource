import { accountUrls } from "@/lib/account/flow";
import { createAppKey } from "@/lib/account/sign-in";

/* The BytNode key made for the app at sign-in, for the app in a browser:
   the session comes in `x-bytnode-session`, the key's secret goes back
   once, to be kept with the page's other keys. */
export async function POST(req: Request) {
  const token = req.headers.get("x-bytnode-session")?.trim() ?? "";
  if (!token) return Response.json({ ok: false, code: "unauthorized", message: "Not signed in.", revoked: true });
  return Response.json(await createAppKey(accountUrls(process.env), token));
}
