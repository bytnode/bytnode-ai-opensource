/* ---------------------------------------------------------------------------
   BytNode's REST API, for the app's own code: the plugins, their views and
   jobs, the key check. (The AI agents read BytNode through its MCP server,
   `lib/mcp/bytnode.ts`; nothing here is for them.)

   One call = one HTTP request with the user's key in `X-API-KEY`, the
   answer's envelope opened (`{status, data, …}`), its error told in plain
   English from the edge's `X-Deny-Reason` and `error.code`. A GET that
   meets a gateway error (502/503/504) or a dropped connection is tried
   once more; a POST never is. The contract is the public OpenAPI
   (`https://api.bytnode.com/openapi.json`).

   ⚠️ SERVER ONLY: the key never leaves the server except towards BytNode.
--------------------------------------------------------------------------- */

export const BYTNODE_API_URL = (process.env.BYTNODE_API_URL ?? "https://api.bytnode.com").replace(/\/+$/, "");

const TIMEOUT_MS = 30_000;

export type RestParams = Record<string, string | number | boolean | undefined | null>;

/** A successful answer: `data` and the rest of the envelope (`next`,
    `unavailable`, `partial`, `coverage`…). */
export type RestOk<T = unknown> = { ok: true; data: T; body: Record<string, unknown> };
export type RestFailure = { ok: false; status: number; code: string; message: string };
export type RestResult<T = unknown> = RestOk<T> | RestFailure;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The query string: `true` is sent as 1, empty values are left out. */
export function query(params: RestParams = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === false || v === "") continue;
    q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** A refusal in plain English, from the status, the edge's reason and the
    engine's own message. `X-Deny-Reason` carries the public `error.code`
    since contract 3.0.0 (`invalid_api_key`, `plan_family`, …); its value
    and the body's code are read alike. */
export function describeRestError(status: number, reason: string | null, code: string, message: string): string {
  const said = message.trim();
  const is = (...codes: string[]) => codes.includes(code) || (reason !== null && codes.includes(reason));
  if (status === 401 || is("missing_api_key", "invalid_api_key")) return "Key refused by BytNode: it is missing, invalid or revoked. Check it on bytnode.com.";
  if (is("plan_websocket")) return "Your BytNode plan has no live (WebSocket) connection.";
  if (is("plan_family")) return `Your BytNode plan does not include this data.${said ? ` (${said})` : ""}`;
  if (is("history_depth")) return `This history goes beyond your BytNode plan.${said ? ` (${said})` : ""}`;
  if (is("quota_exceeded")) return "Your BytNode plan's monthly quota is used up.";
  if (status === 429) return "BytNode refused the request: too many requests at once. Try again in a moment.";
  if (status === 422 || status === 404) return said ? `BytNode refused the request: ${said}` : `BytNode refused the request (HTTP ${status}).`;
  if (status >= 500) return `BytNode answered with an error (HTTP ${status}). Try again in a moment.`;
  return said ? `BytNode answered with an error (HTTP ${status}): ${said}` : `BytNode answered with an error (HTTP ${status}).`;
}

const RETRY = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 500;

async function send<T>(method: "GET" | "POST", apiKey: string, path: string, params: RestParams | undefined, body: unknown, signal?: AbortSignal): Promise<RestResult<T>> {
  const key = apiKey.trim();
  if (!key) return { ok: false, status: 401, code: "no_api_key", message: "No BytNode key: add yours in Settings." };
  const url = `${BYTNODE_API_URL}${path.startsWith("/") ? path : `/${path}`}${query(params)}`;
  const attempts = method === "GET" ? 2 : 1;
  let last: RestFailure = { ok: false, status: 0, code: "unreachable", message: "BytNode is unreachable." };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "X-API-KEY": key, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        cache: "no-store",
      });
    } catch (e) {
      if (signal?.aborted) return { ok: false, status: 0, code: "aborted", message: "The request was cancelled." };
      const detail = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      /* A request that timed out is not sent again: it would double the wait. */
      if (timeout.aborted) return { ok: false, status: 0, code: "timeout", message: "BytNode did not answer in time." };
      last = { ok: false, status: 0, code: "unreachable", message: `BytNode is unreachable: ${detail}` };
      continue;
    }
    const json: unknown = await res.json().catch(() => null);
    if (res.ok && isRecord(json) && json.status !== "error") return { ok: true, data: json.data as T, body: json };
    const err = isRecord(json) && isRecord(json.error) ? json.error : {};
    const code = typeof err.code === "string" ? err.code : "";
    const message = typeof err.message === "string" ? err.message : "";
    last = { ok: false, status: res.status, code, message: describeRestError(res.status, res.headers.get("x-deny-reason"), code, message) };
    if (!RETRY.has(res.status)) return last;
  }
  return last;
}

/** `GET <path>?<params>` on BytNode's API. */
export const restGet = <T = unknown>(apiKey: string, path: string, params?: RestParams, signal?: AbortSignal) => send<T>("GET", apiKey, path, params, undefined, signal);

/** `POST <path>` with a JSON body (only `/v1/indicators` takes one). */
export const restPost = <T = unknown>(apiKey: string, path: string, body: unknown, signal?: AbortSignal) => send<T>("POST", apiKey, path, undefined, body, signal);

/** The paths a plugin may POST to: the others are read with GET. */
export const POST_PATHS = new Set(["/v1/indicators"]);
