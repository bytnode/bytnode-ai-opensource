import type { AccountBridge, AccountState, BytnodeAccount, KeyResult, SignInResult } from "./account";
import type { Storage } from "@/lib/storage/storage";

/* ---------------------------------------------------------------------------
   The BytNode account of the app in the browser (`next dev`, `npx
   bytnode-ai`): a single sign-on with bytnode.com (user request,
   2026-10-12), not a key to fetch by hand from the console.

   This bridge works with the app's server:
   - « Sign in » opens a tab at once (still inside the click, or the browser
     blocks it), asks the server to start the sign-in
     (`app/api/account/sign-in`: listener, PKCE, exchange,
     `lib/account/sign-in.ts`), sends the tab to bytnode.com, then waits
     for the outcome and closes the tab;
   - the session `bnd_…` is kept in this browser's storage, with the app's
     other keys — a new browser profile starts signed out — and sent to
     the server only for the account's own calls (the key made for the
     app, the check, the sign-out).
--------------------------------------------------------------------------- */

export const ACCOUNT_STORAGE_KEY = "agentchat:account";

/** The tab the sign-in happens in. */
export type SignInTab = { go(url: string): void; close(): void };

export type BrowserBridgeDeps = {
  storage: Storage;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Opens an empty tab; null when the browser refused. Called inside the click. */
  openTab: () => SignInTab | null;
  /** Between two tries when the server could not be reached. */
  pause?: (ms: number) => Promise<void>;
};

type Stored = { token: string; account: BytnodeAccount };

const RETRY_MS = 2_000;

function readStored(storage: Storage): Stored | null {
  try {
    const o = JSON.parse(storage.get(ACCOUNT_STORAGE_KEY) ?? "null") as { token?: unknown; account?: { email?: unknown; name?: unknown; avatarUrl?: unknown } } | null;
    const a = o?.account;
    if (!o || typeof o.token !== "string" || !o.token.startsWith("bnd_") || typeof a?.email !== "string" || !a.email) return null;
    return { token: o.token, account: { email: a.email, name: typeof a.name === "string" ? a.name : null, avatarUrl: typeof a.avatarUrl === "string" ? a.avatarUrl : null } };
  } catch {
    return null;
  }
}

export function createBrowserBridge(deps: BrowserBridgeDeps): AccountBridge & { check(): Promise<void>; changedElsewhere(): void } {
  const { storage, openTab } = deps;
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const listeners = new Set<(s: AccountState) => void>();
  let reason: string | null = null;
  let current: { id: string | null; tab: SignInTab; cancelled: boolean } | null = null;

  const state = (): AccountState => {
    const s = readStored(storage);
    return s ? { signedIn: true, account: s.account } : { signedIn: false, reason };
  };
  const announce = () => {
    const s = state();
    for (const l of listeners) l(s);
  };
  const signOutLocally = (why: string | null) => {
    storage.remove(ACCOUNT_STORAGE_KEY);
    reason = why;
    announce();
  };
  const sessionHeaders = (token: string) => ({ "x-bytnode-session": token });

  const json = async (res: Response): Promise<Record<string, unknown>> => {
    const body: unknown = await res.json().catch(() => null);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  };

  const cancel = async (): Promise<void> => {
    const run = current;
    if (!run) return;
    current = null;
    run.cancelled = true;
    run.tab.close();
    if (run.id) await deps.fetch(`/api/account/sign-in?id=${encodeURIComponent(run.id)}`, { method: "DELETE" }).catch(() => null);
  };

  const signIn = async (): Promise<SignInResult> => {
    /* The tab first: after an `await` the click is over and the browser
       would block it. */
    const tab = openTab();
    void cancel();
    if (!tab) return { ok: false, cancelled: false, message: "The browser could not be opened (the new tab was blocked)." };
    const run = { id: null as string | null, tab, cancelled: false };
    current = run;
    const fail = (message: string): SignInResult => {
      if (current === run) current = null;
      return { ok: false, cancelled: false, message };
    };

    let start: Record<string, unknown>;
    try {
      start = await json(await deps.fetch("/api/account/sign-in", { method: "POST" }));
    } catch (e) {
      tab.close();
      return fail(`The app could not wait for the browser (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (run.cancelled) {
      /* Cancelled before the server answered: it forgets that one too. */
      if (typeof start.id === "string") await deps.fetch(`/api/account/sign-in?id=${encodeURIComponent(start.id)}`, { method: "DELETE" }).catch(() => null);
      return { ok: false, cancelled: true, message: "" };
    }
    if (typeof start.id !== "string" || typeof start.url !== "string") {
      tab.close();
      return fail(typeof start.message === "string" && start.message ? start.message : "The app could not wait for the browser (no answer).");
    }
    run.id = start.id;
    tab.go(start.url);

    for (;;) {
      if (run.cancelled) return { ok: false, cancelled: true, message: "" };
      let o: Record<string, unknown>;
      try {
        o = await json(await deps.fetch(`/api/account/sign-in?id=${encodeURIComponent(start.id)}`, { cache: "no-store" }));
      } catch {
        await pause(RETRY_MS);
        continue;
      }
      if (run.cancelled) return { ok: false, cancelled: true, message: "" };
      if (o.pending === true) continue;
      if (current === run) current = null;
      const session = o.ok === true ? (o.session as Stored | undefined) : undefined;
      if (session && typeof session.token === "string" && session.account) {
        storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify(session));
        reason = null;
        tab.close();
        if (typeof window !== "undefined") window.focus();
        /* Not announced: the sign-in page sets the app up first (its key,
           the profile), then reads the account again. */
        return { ok: true, account: session.account };
      }
      /* The tab stays: bytnode.com tells there what went wrong. */
      return o.cancelled === true ? { ok: false, cancelled: true, message: "" } : { ok: false, cancelled: false, message: typeof o.message === "string" && o.message ? o.message : "The sign-in failed." };
    }
  };

  const createApiKey = async (): Promise<KeyResult> => {
    const s = readStored(storage);
    if (!s) return { ok: false, code: "unauthorized", message: "Not signed in." };
    try {
      const r = await json(await deps.fetch("/api/account/key", { method: "POST", headers: sessionHeaders(s.token) }));
      if (r.ok === true && typeof r.secret === "string") return { ok: true, secret: r.secret };
      const message = typeof r.message === "string" ? r.message : "The key could not be made.";
      if (r.revoked === true) signOutLocally(message);
      return { ok: false, code: typeof r.code === "string" ? r.code : "error", message };
    } catch (e) {
      return { ok: false, code: "network_error", message: `bytnode.com could not be reached (${e instanceof Error ? e.message : String(e)}).` };
    }
  };

  const signOut = async (): Promise<void> => {
    const s = readStored(storage);
    signOutLocally(null);
    if (s) await deps.fetch("/api/account/session", { method: "DELETE", headers: sessionHeaders(s.token) }).catch(() => null);
  };

  /** At start: still a valid session? Revoked → the sign-in page again. */
  const check = async (): Promise<void> => {
    const s = readStored(storage);
    if (!s) return;
    try {
      const me = await json(await deps.fetch("/api/account/session", { headers: sessionHeaders(s.token), cache: "no-store" }));
      if (readStored(storage)?.token !== s.token) return;
      if (me.kind === "revoked") signOutLocally(typeof me.message === "string" ? me.message : null);
      else if (me.kind === "ok" && me.account && JSON.stringify(me.account) !== JSON.stringify(s.account)) {
        storage.set(ACCOUNT_STORAGE_KEY, JSON.stringify({ token: s.token, account: me.account }));
        announce();
      }
    } catch {
      /* the app's server is not there: nothing to say */
    }
  };

  return {
    state,
    signIn,
    cancel,
    createApiKey,
    signOut,
    check,
    /** Another tab of the app signed in or out. */
    changedElsewhere: announce,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The tab, for real: opened empty inside the click, sent to bytnode.com
    once the server has its address. */
export function windowTab(): SignInTab | null {
  const w = window.open("", "_blank");
  if (!w) return null;
  return {
    go(url) {
      try {
        /* bytnode.com does not need to reach back into the app. */
        w.opener = null;
      } catch {
        /* read-only in some browsers */
      }
      w.location.href = url;
    },
    close() {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    },
  };
}
