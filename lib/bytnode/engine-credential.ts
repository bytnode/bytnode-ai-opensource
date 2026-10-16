import { createHash, createHmac } from "node:crypto";

/* ---------------------------------------------------------------------------
   The app's credential on BytNode's engine (owner decision, 2026-10-16).

   Derived from the BytNode account session (`bnd_…`):
     bne_ + base64url( HMAC-SHA256( key = SHA-256(session), "bytnode-engine-v1" ) )
   bytnode.com keeps only SHA-256(session), so it derives the same string and
   PROVISIONS it on the engine, like an API key, with the rights of the app's
   built-in plugins and nothing more (no quota, nothing in the user's console).
   Revoked with the session. It opens nothing on bytnode.com: that needs the
   session itself, and SHA-256 does not run backwards.

   Pure, Node only.
--------------------------------------------------------------------------- */

export const ENGINE_PREFIX = "bne_";
const CONTEXT = "bytnode-engine-v1";

const SESSION = /^bnd_[A-Za-z0-9_-]{8,}$/;
const CREDENTIAL = /^bne_[A-Za-z0-9_-]{43}$/;

export const isSession = (t: string): boolean => SESSION.test(t);
export const isEngineCredential = (t: string): boolean => CREDENTIAL.test(t);

/** The engine credential of an account session. */
export function engineCredential(session: string): string {
  const h = createHash("sha256").update(session, "utf8").digest();
  return ENGINE_PREFIX + createHmac("sha256", h).update(CONTEXT, "utf8").digest("base64url");
}

/** What a caller handed over (a session, or a credential already derived)
    as the engine credential; null when it is neither. */
export function credentialOf(given: string | null | undefined): string | null {
  const t = typeof given === "string" ? given.trim() : "";
  if (isEngineCredential(t)) return t;
  if (isSession(t)) return engineCredential(t);
  return null;
}
