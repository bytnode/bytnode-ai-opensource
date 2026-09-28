import { createHmac, timingSafeEqual } from "node:crypto";
import type { Grant } from "./permissions";

/* ---------------------------------------------------------------------------
   The user's approval of a plugin written by an agent, made unforgeable.

   ⚠️ WHY. An agent that has a shell could approve its own plugin: a script
   forging the review screen's headers called the approve route (the audit
   got `{"state":"active"}`), or it could simply write `grant.json`. Headers
   and files are within any local process's reach; what an agent does NOT
   hold is a secret that lives only in the user's browser.

   THE KEY. 32 random bytes generated once in the browser, kept in its
   settings (`localStorage`). It reaches the server only in memory: through
   the tab's heartbeat (`POST /api/session`) and on each approval. The
   server never writes it, never logs it, never returns it. The first key
   received after the server starts is the one (trust on first use — the
   browser tab speaks on load, before any agent can run); a DIFFERENT key is
   refused while the registered one is alive.

   THE SIGNATURE. An approval signs what the user granted — the plugin's
   id, its permissions and its accounts — with the key (`sig` in
   `grant.json`). The code's digest is NOT signed: an approved plugin that
   changes WITHOUT asking for more (the live update of `PluginWrite`) keeps
   its signature, as it keeps its rights. A grant whose signature does not
   verify does not run (`activePlugins`): written by hand, copied from
   another plugin, widened, or older than this lock (approve it again).

   The MCP servers of subscription agents never get the key: the Next
   server passes them the signatures it verified
   (`BYTNODE_AI_VERIFIED_GRANTS`), and they run only those.
--------------------------------------------------------------------------- */

const KEY_FORMAT = /^[0-9a-f]{64}$/;
/** A key not refreshed by a heartbeat for this long may be replaced (the tab
    was closed, the browser's data cleared). As the session's TTL. */
const KEY_TTL_MS = 150_000;

export const isApprovalKey = (v: unknown): v is string => typeof v === "string" && KEY_FORMAT.test(v);

/** What is signed: the plugin, and what it may reach. */
export function grantPayload(id: string, grant: Pick<Grant, "permissions" | "accounts">): string {
  const p = grant.permissions;
  return JSON.stringify({
    id,
    network: [...p.network].sort(),
    bytnode: p.bytnode,
    exchange: p.exchange,
    schedule: p.schedule,
    notify: p.notify,
    accounts: [...grant.accounts].sort(),
  });
}

export const signGrant = (key: string, id: string, grant: Pick<Grant, "permissions" | "accounts">): string =>
  createHmac("sha256", Buffer.from(key, "hex")).update(grantPayload(id, grant)).digest("hex");

const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function verifyGrant(key: string, id: string, grant: Grant): boolean {
  return typeof grant.sig === "string" && sameHex(grant.sig, signGrant(key, id, grant));
}

/** The registered key, in this process's memory. */
export class ApprovalKeyHolder {
  private key: string | null = null;
  private at = 0;

  /** A heartbeat's key: accepted when none is alive or it is the same one. */
  register(key: string, now = Date.now()): boolean {
    if (!isApprovalKey(key)) return false;
    if (this.key && this.key !== key && now - this.at <= KEY_TTL_MS) return false;
    this.key = key;
    this.at = now;
    return true;
  }

  /** The key, if one was registered (it stays usable to verify grants
      after its heartbeat stopped: nothing new can be approved without a
      tab anyway). */
  current(): string | null {
    return this.key;
  }

  /** Does this request carry the registered key? */
  matches(candidate: string | null): boolean {
    return !!this.key && typeof candidate === "string" && sameHex(candidate, this.key);
  }
}

const g = globalThis as { __bnaiApprovalKey?: ApprovalKeyHolder };
export const approvalKey = (): ApprovalKeyHolder => (g.__bnaiApprovalKey ??= new ApprovalKeyHolder());

export const VERIFIED_GRANTS_ENV = "BYTNODE_AI_VERIFIED_GRANTS";

/** Does this grant carry the user's approval? In the Next server: its
    signature verifies with the registered key. In an MCP server (the env
    variable is set, even empty): it is one the Next server verified. */
export function isTrustedGrant(id: string, grant: Grant, env: Record<string, string | undefined> = process.env): boolean {
  const passed = env[VERIFIED_GRANTS_ENV];
  if (passed !== undefined) {
    try {
      const map = JSON.parse(passed || "{}") as Record<string, string>;
      return typeof grant.sig === "string" && map[id] === grant.sig;
    } catch {
      return false;
    }
  }
  const key = approvalKey().current();
  return !!key && verifyGrant(key, id, grant);
}

export const UNTRUSTED_GRANT = "Its approval is not signed by your browser (written by hand, or given before the security update): it does not run. Approve it again from its review.";
