/* ---------------------------------------------------------------------------
   BytNode's REST API, for the app's own code: the built-in plugins (their
   views, jobs and tools), the plugins written by an agent (`ctx.bytnode`),
   the key check. (An agent's own reads go through BytNode's MCP server,
   `lib/mcp/bytnode.ts`; nothing here is for them.)

   One call = one HTTP request with a key in `X-API-KEY`: the app's
   credential when the caller passes `APP_PASS` (`lib/bytnode/app-pass.ts`,
   no quota spent; only the plugins' reads, `./app-reads.ts`, and only to
   BytNode's own host, `appApiUrl`), the user's key otherwise. In a
   subscription agent's MCP server, `APP_PASS` reads go through the Next
   server's relay instead (it holds the credential, this process does not).
   The
   answer's envelope opened (`{status, data, …}`), its error told in plain
   English from the edge's `X-Deny-Reason` and `error.code`. A GET that
   meets a gateway error (502/503/504) or a dropped connection is tried
   once more; a POST never is. The contract is the public OpenAPI
   (`https://api.bytnode.com/openapi.json`).

   ⚠️ SERVER ONLY: the key never leaves the server except towards BytNode.
--------------------------------------------------------------------------- */

import { APP_PASS, appPass, appRelay, dropAppPass, LINK_HEADER } from "./app-pass";
import { isAppRead } from "./app-reads";

export const BYTNODE_API_URL = (process.env.BYTNODE_API_URL ?? "https://api.bytnode.com").replace(/\/+$/, "");

/** Where the app's credential goes: BytNode's own host — an override
    (`BYTNODE_API_URL`, a local engine) only outside a production build, so
    nobody can point the installed app's credential at another host.
    `process.env.NODE_ENV` is written out so the build fixes it in the code:
    the environment the app is started with cannot change it. */
export const appApiUrl = (env: Record<string, string | undefined> = process.env, production = process.env.NODE_ENV === "production"): string =>
  production ? "https://api.bytnode.com" : (env.BYTNODE_API_URL ?? "https://api.bytnode.com").replace(/\/+$/, "");

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
  if (apiKey !== APP_PASS) return sendWith<T>(BYTNODE_API_URL, method, apiKey.trim(), path, params, body, signal);
  return appRead<T>(method, path, params, body, signal);
}

/** A read for the app's built-in plugins, on the app's credential (or
    through the relay, in an agent's MCP server). */
export async function appRead<T = unknown>(method: "GET" | "POST", path: string, params: RestParams | undefined, body: unknown, signal?: AbortSignal): Promise<RestResult<T>> {
  if (!isAppRead(method, path)) return { ok: false, status: 403, code: "not_an_app_read", message: `BytNode-AI does not read ${method} ${path} for its plugins.` };
  const relay = appRelay();
  if (relay) return sendRelay<T>(relay, method, path, params, body, signal);
  const access = await appPass();
  if (!access.ok) return { ok: false, status: 401, code: "no_app_access", message: access.message };
  const res = await sendWith<T>(appApiUrl(), method, access.token, path, params, body, signal);
  /* Not provisioned yet (just signed in) or revoked: not sent again for a while. */
  if (!res.ok && res.status === 401) dropAppPass(access.token);
  return res;
}

const isFailure = (v: unknown): v is RestFailure =>
  isRecord(v) && v.ok === false && typeof v.status === "number" && typeof v.code === "string" && typeof v.message === "string";

/** A read relayed through the Next server (`app/api/bytnode/read`). */
async function sendRelay<T>(relay: { url: string; token: string }, method: "GET" | "POST", path: string, params: RestParams | undefined, body: unknown, signal?: AbortSignal): Promise<RestResult<T>> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS + 5_000);
  try {
    const res = await fetch(relay.url, {
      method: "POST",
      headers: { [LINK_HEADER]: relay.token, "content-type": "application/json" },
      body: JSON.stringify({ method, path, params: params ?? {}, body }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
      redirect: "error",
    });
    const json: unknown = await res.json().catch(() => null);
    if (isRecord(json) && json.ok === true && isRecord(json.body)) return { ok: true, data: json.data as T, body: json.body };
    if (isFailure(json)) return { ok: false, status: json.status, code: json.code, message: json.message };
    return { ok: false, status: res.status, code: "relay", message: `BytNode-AI did not relay the reading (HTTP ${res.status}).` };
  } catch (e) {
    if (signal?.aborted) return { ok: false, status: 0, code: "aborted", message: "The request was cancelled." };
    return { ok: false, status: 0, code: "unreachable", message: `BytNode-AI could not be reached to read BytNode (${e instanceof Error ? e.message : String(e)}).` };
  }
}

async function sendWith<T>(base: string, method: "GET" | "POST", key: string, path: string, params: RestParams | undefined, body: unknown, signal?: AbortSignal): Promise<RestResult<T>> {
  if (!key) return { ok: false, status: 401, code: "no_api_key", message: "No BytNode key: add yours in Settings." };
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${query(params)}`;
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
        /* A key never follows a redirect to another host. */
        redirect: "error",
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
