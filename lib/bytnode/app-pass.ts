import { randomBytes, timingSafeEqual } from "node:crypto";
import { credentialOf } from "./engine-credential";
import { APP_PASS } from "./pass-id";

export { APP_PASS };

/* ---------------------------------------------------------------------------
   The app's own access to BytNode (owner decision, 2026-10-16).

   What the app reads of BytNode for itself — the built-in plugins, their
   views, background jobs and tools — goes on the APP'S CREDENTIAL, not on
   the user's key: no quota spent, nothing in the user's console. The user's
   key stays for what an agent reads directly (the BytNode MCP in a chat,
   the subscription agents) and for the plugins written by an agent.

   The credential (`bne_…`, `./engine-credential.ts`) is derived from the
   BytNode account session; bytnode.com provisions the same string on the
   engine, which opens it on the plugins' routes only (`./app-reads.ts`) and
   closes it with the session. No secret of the app's own is involved: there
   is nothing here worth more than what the user's own sign-in gives.
   It lives in this process's memory only: never written to disk, never sent
   to the page; it is sent to BytNode's own hosts only (`appApiUrl`).

   Where the session comes from: the page keeps it, and sends it with its
   heartbeat (`POST /api/session`, header `x-bytnode-session`).
   A subscription agent's MCP server (another process: the plugins' tools)
   holds no credential: it RELAYS its reads through this server
   (`POST /api/bytnode/read`, with the link secret it was started with),
   which checks them against `./app-reads.ts` and answers with the data.

   Code reading BytNode for the app passes `APP_PASS` where a key goes;
   `lib/bytnode/rest.ts` and `lib/bytnode/live.ts` put the credential (or
   the relay) in its place. SERVER ONLY.
--------------------------------------------------------------------------- */

export type PassResult = { ok: true; token: string } | { ok: false; message: string };

/** How long a reading waits for the session (the page's first heartbeat). */
const SESSION_WAIT_MS = 4_000;
/** The page's session is forgotten when the page has not spoken for this long. */
const PAGE_TTL_MS = 150_000;
/** A credential BytNode refused (not provisioned yet, or revoked) is not
    sent again before this. */
const REFUSED_MS = 15_000;

export const SESSION_HEADER = "x-bytnode-session";
export const LINK_HEADER = "x-bytnode-app-read";
/** The env of an MCP server started for a subscription agent. */
export const LINK_ENV = { url: "BYTNODE_AI_APP_READ_URL", token: "BYTNODE_AI_APP_READ_TOKEN" } as const;

const NOT_SIGNED_IN = "Not signed in to BytNode: sign in to read market data.";
const REFUSED = "BytNode does not recognise this app's sign-in yet: try again in a moment, or sign in again if it lasts.";

type State = {
  page: { credential: string; at: number } | null;
  refused: { credential: string; until: number } | null;
  /** A wait for the session ended with none: not waited for again before. */
  signedOutUntil: number;
  waiters: Set<() => void>;
  origin: string | null;
  link: string;
};

/* On the server's global: a hot reload must not drop the session. */
const SLOT = Symbol.for("bytnode-ai.app-pass");
const state = (): State => {
  const g = globalThis as unknown as Record<symbol, State | undefined>;
  return (g[SLOT] ??= { page: null, refused: null, signedOutUntil: 0, waiters: new Set(), origin: null, link: randomBytes(32).toString("hex") });
};

/** The credential the app reads with: the page's, while it speaks. */
function current(now = Date.now()): string | null {
  const s = state();
  if (s.page && now - s.page.at <= PAGE_TTL_MS) return s.page.credential;
  return null;
}

/** The session as the page has it now; `null` = signed out. Only the
    derived credential is kept. */
export function setAccountSession(token: string | null, now = Date.now()): void {
  const s = state();
  const credential = credentialOf(token);
  s.page = credential ? { credential, at: now } : null;
  for (const w of [...s.waiters]) w();
}

/** The Next server's address, for the MCP servers it starts to relay their
    reads through it. */
export function rememberOrigin(origin: string): void {
  if (/^https?:\/\/[^/]+$/.test(origin)) state().origin = origin;
}

/** What an MCP server needs to relay its reads through this server; null
    when the address is not known yet. */
export function passLink(): { url: string; token: string } | null {
  const s = state();
  return s.origin ? { url: `${s.origin}/api/bytnode/read`, token: s.link } : null;
}

/** The relay this process reads through (an MCP server started for a
    subscription agent); null in the Next server itself. */
export function appRelay(): { url: string; token: string } | null {
  const url = process.env[LINK_ENV.url]?.trim();
  const token = process.env[LINK_ENV.token]?.trim();
  return url && token ? { url, token } : null;
}

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

/** True when `given` is this server's link secret. */
export const isPassLink = (given: string | null) => sameSecret(given ?? "", state().link);

function waitForCredential(ms: number): Promise<string | null> {
  const now = current();
  if (now || ms <= 0) return Promise.resolve(now);
  const s = state();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      s.waiters.delete(check);
      resolve(current());
    };
    const check = () => {
      if (current()) done();
    };
    const timer = setTimeout(done, ms);
    (timer as { unref?: () => void }).unref?.();
    s.waiters.add(check);
  });
}

/** The credential to read BytNode with for the app. In a relay process
    there is none (its reads go through the relay; no live feed there). */
export async function appPass(): Promise<PassResult> {
  if (appRelay()) return { ok: false, message: "BytNode's live prices are read by BytNode-AI itself, not here." };
  const s = state();
  const credential = await waitForCredential(Date.now() < s.signedOutUntil ? 0 : SESSION_WAIT_MS);
  if (!credential) {
    s.signedOutUntil = Date.now() + REFUSED_MS;
    return { ok: false, message: NOT_SIGNED_IN };
  }
  const refused = s.refused;
  if (refused?.credential === credential && Date.now() < refused.until) return { ok: false, message: REFUSED };
  return { ok: true, token: credential };
}

/** BytNode refused this credential (not provisioned yet, or revoked): not
    sent again for a while. */
export function dropAppPass(token: string): void {
  state().refused = { credential: token, until: Date.now() + REFUSED_MS };
}

/** Forgets everything (tests). */
export function resetAppPass(): void {
  const s = state();
  Object.assign(s, { page: null, refused: null, signedOutUntil: 0, origin: null });
  s.waiters.clear();
}
