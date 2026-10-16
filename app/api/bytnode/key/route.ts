import { userKey } from "@/lib/bytnode/pass-id";
import { restGet } from "@/lib/bytnode/rest";

/* Checks a BytNode key: BytNode's REST API accepts it and lists its pairs
   (`/v1/symbols` wants a key). */
export async function GET(req: Request) {
  const key = userKey(req.headers.get("x-bytnode-key") ?? "");
  if (!key.trim()) return Response.json({ error: { message: "No BytNode key provided." } }, { status: 401 });
  const r = await restGet<unknown[]>(key, "/v1/symbols");
  if (!r.ok) return Response.json({ error: { message: r.message } }, { status: 401 });
  return Response.json({ ok: true, pairs: Array.isArray(r.data) ? r.data.length : 0 });
}
