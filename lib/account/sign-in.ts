import http from "node:http";
import os from "node:os";
import { accountOf, deviceName, doneUrl, errorOf, pkcePair, randomState, readCallback, signInUrl, type AccountUrls, type BytnodeAccount } from "./flow";

/* ---------------------------------------------------------------------------
   The BytNode account's sign-in and calls, server side (user request,
   2026-10-12): the app's server (`app/api/account/*`) does the sign-in,
   the page keeps the session with its other keys
   (`lib/account/browser.ts`).

   One sign-in = a listener on 127.0.0.1 (a free port, for its time only),
   bytnode.com/auth/desktop opened with the PKCE challenge, the one-time
   code exchanged with the verifier for a session `bnd_…`. The pure part —
   addresses, PKCE, the callback — is `flow.ts`.
--------------------------------------------------------------------------- */

export type AccountSession = { token: string; account: BytnodeAccount };

export type SignInOutcome = { ok: true; session: AccountSession } | { ok: false; cancelled: boolean; message: string };

/** `revoked`: bytnode.com refused the session (signed out there, account
    deleted) — the app signs out. */
export type KeyOutcome = { ok: true; secret: string } | { ok: false; code: string; message: string; revoked: boolean };

export type MeOutcome = { kind: "ok"; account: BytnodeAccount } | { kind: "revoked"; message: string } | { kind: "unknown" };

/** How long the browser has to come back. */
export const SIGN_IN_TIMEOUT = 10 * 60_000;
/** A call to bytnode.com that does not answer: the app does not wait on it. */
const CALL_TIMEOUT = 15_000;

export async function accountCall(urls: AccountUrls, route: string, init: { method: string; token?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${urls.api}${route}`, {
    method: init.method,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(CALL_TIMEOUT),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: the status says enough */
  }
  return { status: res.status, body };
}

const unreachable = (e: unknown) => `bytnode.com could not be reached (${e instanceof Error ? e.message : String(e)}).`;

/** Starts a sign-in: `open` gets the bytnode.com address once the listener
    is up (a throw = the browser could not be opened). `result` settles when
    the browser comes back, on `cancel()`, or after `SIGN_IN_TIMEOUT`. */
export function startSignIn(urls: AccountUrls, open: (url: string) => void | Promise<void>): { result: Promise<SignInOutcome>; cancel: () => void } {
  const { verifier, challenge } = pkcePair();
  const expected = randomState();
  let finish: (r: SignInOutcome) => void = () => {};
  const result = new Promise<SignInOutcome>((resolve) => {
    let done = false;
    finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      resolve(r);
    };
    const back = (res: http.ServerResponse, ok: boolean) => {
      res.writeHead(302, { location: doneUrl(urls.site, ok), "cache-control": "no-store" });
      res.end();
    };
    const server = http.createServer((req, res) => {
      const cb = readCallback(req.url ?? "", expected);
      if (cb.kind === "ignore") {
        res.writeHead(404).end();
        return;
      }
      if (cb.kind === "error") {
        back(res, false);
        finish({ ok: false, cancelled: false, message: cb.message });
        return;
      }
      void accountCall(urls, "/auth/desktop/token", { method: "POST", body: { code: cb.code, code_verifier: verifier, device_name: deviceName(process.platform, os.hostname()) } })
        .then(({ status, body }) => {
          const token = (body as { token?: unknown } | null)?.token;
          const account = accountOf((body as { account?: unknown } | null)?.account);
          if (status !== 200 || typeof token !== "string" || !account) {
            back(res, false);
            finish({ ok: false, cancelled: false, message: errorOf(body, status).message });
            return;
          }
          back(res, true);
          finish({ ok: true, session: { token, account } });
        })
        .catch((e) => {
          back(res, false);
          finish({ ok: false, cancelled: false, message: unreachable(e) });
        });
    });
    const timer = setTimeout(() => finish({ ok: false, cancelled: false, message: "The sign-in took too long. Try again." }), SIGN_IN_TIMEOUT);
    server.on("error", (e) => finish({ ok: false, cancelled: false, message: `The app could not wait for the browser (${e.message}).` }));
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      Promise.resolve()
        .then(() => open(signInUrl(urls.site, { challenge, port, state: expected })))
        .catch((e: unknown) => finish({ ok: false, cancelled: false, message: `The browser could not be opened (${e instanceof Error ? e.message : String(e)}).` }));
    });
  });
  return { result, cancel: () => finish({ ok: false, cancelled: true, message: "" }) };
}

/** The BytNode key made for the app (`POST /desktop/api-key`). */
export async function createAppKey(urls: AccountUrls, token: string): Promise<KeyOutcome> {
  try {
    const { status, body } = await accountCall(urls, "/desktop/api-key", { method: "POST", token });
    const secret = (body as { secret?: unknown } | null)?.secret;
    if (status === 201 && typeof secret === "string" && secret) return { ok: true, secret };
    return { ok: false, ...errorOf(body, status), revoked: status === 401 };
  } catch (e) {
    return { ok: false, code: "network_error", message: unreachable(e), revoked: false };
  }
}

/** Is the session still good, and the account as bytnode.com has it now.
    Offline or bytnode.com down: `unknown`, the app keeps going. */
export async function readMe(urls: AccountUrls, token: string): Promise<MeOutcome> {
  try {
    const { status, body } = await accountCall(urls, "/desktop/me", { method: "GET", token });
    if (status === 401) return { kind: "revoked", message: errorOf(body, status).message };
    const account = status === 200 ? accountOf(body) : null;
    return account ? { kind: "ok", account } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

/** Revoked on bytnode.com when it answers; offline, the local session is
    gone all the same, and the token is never used again. */
export async function revokeSession(urls: AccountUrls, token: string): Promise<void> {
  await accountCall(urls, "/desktop/session", { method: "DELETE", token }).catch(() => null);
}
