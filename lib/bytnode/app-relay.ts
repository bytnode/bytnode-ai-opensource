import { isPassLink } from "./app-pass";
import { isAppRead } from "./app-reads";
import { appRead, type RestParams, type RestResult } from "./rest";

/* ---------------------------------------------------------------------------
   The relay a subscription agent's MCP server reads BytNode through
   (`POST /api/bytnode/read`): the plugins' tools run in that process, which
   holds no credential. The caller proves itself with the link secret it was
   started with; the read must be one of the plugins' (`./app-reads.ts`);
   the answer is the data, or a refusal told in plain English — never a key.
   SERVER ONLY.
--------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Query values as the REST client takes them; null when one is not. */
function paramsOf(v: unknown): RestParams | null {
  if (v === undefined) return {};
  if (!isRecord(v)) return null;
  const out: RestParams = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = x;
    else return null;
  }
  return out;
}

/** The relay's answer to a request: its HTTP status and JSON body. */
export async function relayRead(link: string | null, raw: unknown, signal?: AbortSignal): Promise<{ status: number; body: RestResult | { message: string } }> {
  if (!isPassLink(link)) return { status: 403, body: { message: "Refused." } };
  if (!isRecord(raw)) return { status: 400, body: { message: "Unreadable request body." } };
  const method = raw.method === "GET" || raw.method === "POST" ? raw.method : null;
  const path = typeof raw.path === "string" ? raw.path : "";
  const params = paramsOf(raw.params);
  if (!method || !isAppRead(method, path) || params === null) return { status: 403, body: { message: "Not one of BytNode-AI's plugin reads." } };
  const res = await appRead(method, path, method === "GET" ? params : undefined, method === "POST" ? raw.body : undefined, signal);
  return { status: 200, body: res };
}
