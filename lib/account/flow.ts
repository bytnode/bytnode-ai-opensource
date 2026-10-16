import { createHash, randomBytes } from "node:crypto";

/* ---------------------------------------------------------------------------
   The BytNode account sign-in, the pure part (tested): what `sign-in.ts`
   sends, what it accepts back. Server side only (node:crypto).

   The app opens bytnode.com/auth/desktop in the user's browser with
   - `challenge`: the S256 of a PKCE verifier only this process keeps
     (RFC 7636): a code caught by anything else listening is useless;
   - `port`: where it listens on 127.0.0.1 for the time of the sign-in
     (RFC 8252 § 7.3 — no URL scheme to register, works unpackaged too);
   - `state`: a random value the callback must carry back, or it is ignored.

   The page, signed in, hands back a one-time code on
   `http://127.0.0.1:<port>/callback?code=…&state=…`; the app exchanges it
   with its verifier for a session of its own (`bnd_…`) and sends the
   browser back to the page with `?done=1` (or `0`).
--------------------------------------------------------------------------- */

export type AccountUrls = { site: string; api: string };

/** Where the account lives: bytnode.com, or a local app_web in
    development (`BYTNODE_AI_ACCOUNT_URL=http://localhost:3000`,
    `BYTNODE_AI_ACCOUNT_API=http://localhost:4000/api`). */
export function accountUrls(env: Record<string, string | undefined>): AccountUrls {
  const trim = (v: string | undefined) => v?.trim().replace(/\/+$/, "") || "";
  const site = trim(env.BYTNODE_AI_ACCOUNT_URL) || "https://bytnode.com";
  return { site, api: trim(env.BYTNODE_AI_ACCOUNT_API) || `${site}/api` };
}

const base64url = (buf: Buffer) => buf.toString("base64url");

/** A PKCE pair: the verifier stays here, the challenge goes to the page. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: challengeOf(verifier) };
}

export const challengeOf = (verifier: string): string => base64url(createHash("sha256").update(verifier).digest());

export const randomState = (): string => base64url(randomBytes(24));

export function signInUrl(site: string, p: { challenge: string; port: number; state: string }): string {
  const q = new URLSearchParams({ challenge: p.challenge, port: String(p.port), state: p.state });
  return `${site}/auth/desktop?${q.toString()}`;
}

/** Where the browser goes once the app has its session (or failed). */
export const doneUrl = (site: string, ok: boolean): string => `${site}/auth/desktop?done=${ok ? "1" : "0"}`;

export type Callback =
  /** Not our callback (a favicon, a stray request): answered 404, the sign-in waits on. */
  | { kind: "ignore" }
  | { kind: "code"; code: string }
  /** The page said why it gave up. */
  | { kind: "error"; message: string };

const CODE = /^[A-Za-z0-9_-]{43}$/;

/** What a request to the loopback listener says. A wrong or missing
    `state` is IGNORED, never an error: anything on this machine can call
    the port, and must not be able to end the sign-in. */
export function readCallback(requestUrl: string, state: string): Callback {
  let u: URL;
  try {
    u = new URL(requestUrl, "http://127.0.0.1");
  } catch {
    return { kind: "ignore" };
  }
  if (u.pathname !== "/callback" || u.searchParams.get("state") !== state) return { kind: "ignore" };
  const error = u.searchParams.get("error");
  if (error) return { kind: "error", message: error.slice(0, 200) };
  const code = u.searchParams.get("code") ?? "";
  return CODE.test(code) ? { kind: "code", code } : { kind: "ignore" };
}

/** What the app says it is, for the account's list of devices. */
export function deviceName(platform: NodeJS.Platform, host: string): string {
  const os = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
  const name = host.trim().slice(0, 40);
  return name ? `BytNode-AI on ${os} (${name})` : `BytNode-AI on ${os}`;
}

/** The message of an API error envelope `{ error: { code, message } }`. */
export function errorOf(body: unknown, status: number): { code: string; message: string } {
  const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return {
    code: typeof e?.code === "string" ? e.code : status === 401 ? "unauthorized" : "error",
    message: typeof e?.message === "string" && e.message ? e.message : `bytnode.com answered ${status}.`,
  };
}

export type BytnodeAccount = { email: string; name: string | null; avatarUrl: string | null };

/** The account as the API returns it (`{ email, name, avatar_url }`). */
export function accountOf(raw: unknown): BytnodeAccount | null {
  const o = raw as { email?: unknown; name?: unknown; avatar_url?: unknown } | null;
  if (!o || typeof o.email !== "string" || !o.email) return null;
  return {
    email: o.email,
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null,
    avatarUrl: typeof o.avatar_url === "string" && o.avatar_url ? o.avatar_url : null,
  };
}
