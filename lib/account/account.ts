"use client";

import { useSyncExternalStore } from "react";
import type { Profile } from "@/lib/domain/types";
import { createStore } from "@/lib/state/store";
import { currentMessages } from "@/lib/i18n/store";
import { BrowserStorage } from "@/lib/storage/storage";
import { ACCOUNT_STORAGE_KEY, createBrowserBridge, windowTab } from "./browser";

/* ---------------------------------------------------------------------------
   The BytNode account, as the page sees it (user request, 2026-10-09).

   The desktop app's preload hands `bytnodeAccount` (`desktop/account.ts`),
   which signs in through the browser and keeps the session in the main
   process. In a browser (`next dev`, `npx bytnode-ai`) the same sign-in
   runs on the app's server, the page keeping the session
   (`./browser.ts`; since 2026-10-12 — before, the browser had no account
   and asked for a BytNode key by hand).

   Signed out, the app shows its sign-in page and nothing else
   (`components/account/sign-in-screen.tsx`). Signing in also prepares the
   rest: a BytNode key made for this app when there is none yet, and the
   profile filled from the account (`setUpAccount`).
--------------------------------------------------------------------------- */

export type DesktopAccount = { email: string; name: string | null; avatarUrl: string | null };

export type AccountState = { signedIn: false; reason: string | null } | { signedIn: true; account: DesktopAccount };

export type SignInResult = { ok: true; account: DesktopAccount } | { ok: false; cancelled: boolean; message: string };

export type KeyResult = { ok: true; secret: string } | { ok: false; code: string; message: string };

export type AccountBridge = {
  state(): AccountState | null;
  signIn(): Promise<SignInResult>;
  cancel(): Promise<void>;
  createApiKey(): Promise<KeyResult>;
  signOut(): Promise<void>;
  onChange(listener: (state: AccountState) => void): () => void;
};

let inBrowser: ReturnType<typeof createBrowserBridge> | null = null;

/** The desktop app's bridge, or the browser's own. `null` only on the server. */
export const accountBridge = (): AccountBridge | null => {
  if (typeof window === "undefined") return null;
  const desktop = (window as typeof window & { bytnodeAccount?: AccountBridge }).bytnodeAccount;
  if (desktop) return desktop;
  if (!inBrowser) {
    const bridge = createBrowserBridge({ storage: new BrowserStorage(), fetch: (input, init) => fetch(input, init), openTab: windowTab });
    /* Signed in or out in another tab of the app. */
    window.addEventListener("storage", (e) => {
      if (e.key === ACCOUNT_STORAGE_KEY || e.key === null) bridge.changedElsewhere();
    });
    inBrowser = bridge;
    void bridge.check();
  }
  return inBrowser;
};

/* `undefined` until read (the server render). */
const store = createStore<AccountState | null | undefined>(undefined, () => {
  const bridge = accountBridge();
  if (!bridge) return null;
  bridge.onChange((state) => store.set(state));
  return bridge.state() ?? { signedIn: false, reason: null };
});

/** The account: `undefined` before the first client read, its state
    otherwise (`null` is left for a page with no bridge at all). */
export function useAccount(): AccountState | null | undefined {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** Read again what the main process holds (after a sign-in or a sign-out). */
export function refreshAccount(): void {
  const bridge = accountBridge();
  if (bridge) store.set(bridge.state() ?? { signedIn: false, reason: null });
}

/* --- What signing in sets up -------------------------------------------- */

/** The BytNode key made for this app at sign-in, or why it could not be:
    the wizard says which (`StepAuth`). In memory: it only matters during
    the first setup. */
export type AccountKeyNote = { kind: "created"; secret: string } | { kind: "failed"; message: string } | null;

/* Kept as what happened, worded when read: the sign-in comes before the
   language is chosen, the wizard shows it after. */
let keyNote: { kind: "created"; secret: string } | { kind: "failed"; limit: boolean; detail: string } | null = null;
export const accountKeyNote = (): AccountKeyNote => {
  if (keyNote?.kind !== "failed") return keyNote;
  const m = currentMessages().account;
  return { kind: "failed", message: keyNote.limit ? m.keyLimit : m.keyFailed(accountErrorText(keyNote.detail)) };
};

/** A sign-in error in the interface's language. The main process
    (`desktop/account.ts`) writes its own in English: those are read back
    and worded again; what bytnode.com answered is shown as it came. */
export function accountErrorText(message: string): string {
  const m = currentMessages().account.errors;
  const inner = (prefix: string) => (message.startsWith(prefix) && message.endsWith(").") ? message.slice(prefix.length, -2) : null);
  if (message === "The sign-in took too long. Try again.") return m.timeout;
  if (message === "Not signed in.") return m.notSignedIn;
  if (message === "Refused.") return m.refused;
  const unreachable = inner("bytnode.com could not be reached (");
  if (unreachable !== null) return m.unreachable(unreachable);
  const cannotWait = inner("The app could not wait for the browser (");
  if (cannotWait !== null) return m.cannotWait(cannotWait);
  const noBrowser = inner("The browser could not be opened (");
  if (noBrowser !== null) return m.noBrowser(noBrowser);
  const status = /^bytnode\.com answered (\d+)\.$/.exec(message);
  if (status) return m.answered(status[1]);
  return message;
}

/** The profile filled from the account — only where it is empty: what the
    user typed stays. Pure. */
export function profileFromAccount(profile: Profile, account: DesktopAccount): Profile {
  const words = (account.name ?? "").split(/\s+/).filter(Boolean);
  return {
    ...profile,
    firstName: profile.firstName.trim() ? profile.firstName : (words[0] ?? ""),
    lastName: profile.lastName.trim() ? profile.lastName : words.slice(1).join(" "),
    email: profile.email.trim() ? profile.email : account.email,
  };
}

/** After a sign-in: a key for the app when there is none yet (an existing
    user keeps theirs), the profile completed. Returns the key to store, or
    null. A failure (10 keys already, offline…) is kept for the wizard,
    which then asks for a key by hand. */
export async function setUpAccount(hasKey: boolean): Promise<string | null> {
  const bridge = accountBridge();
  if (!bridge || hasKey) return null;
  const r = await bridge.createApiKey();
  if (r.ok) {
    keyNote = { kind: "created", secret: r.secret };
    return r.secret;
  }
  keyNote = { kind: "failed", limit: r.code === "api_key_limit_reached", detail: r.message };
  return null;
}
