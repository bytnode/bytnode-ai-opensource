"use client";

import { useSyncExternalStore } from "react";
import type { Settings } from "@/lib/domain/types";
import { SETTINGS_KEY, SettingsRepository, defaultSettings } from "@/lib/storage/repositories";
import type { Vault } from "@/lib/storage/secrets";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";
import { onStorageChange } from "./sync";

type State = { ready: boolean; settings: Settings };

/* In the desktop window, the system's vault for the keys (`desktop/
   preload.ts` → `lib/storage/secrets.ts`); in a browser, none. */
const desktopVault = (): Vault | null => (typeof window === "undefined" ? null : ((window as typeof window & { bytnodeVault?: Vault }).bytnodeVault ?? null));

const repo = new SettingsRepository(new BrowserStorage(), desktopVault());

/* ⚠️ TWO TABS SHARE ONE STORAGE. Each tab used to keep its first read and
   save its own copy whole: a key or an exchange account deleted in one tab
   came back with the next change made in the other. So a change patches
   what is STORED (`updateSettings`), and a change made elsewhere reaches
   this tab through the `storage` event — which fires only in the OTHER
   tabs, never in the writer: no loop.
   Except when this tab's last save did not fit (quota): its settings are
   then AHEAD of storage, and re-reading storage would drop that change. */
let unsaved = false;

const store = createStore<State>({ ready: false, settings: defaultSettings() }, () => {
  onStorageChange(SETTINGS_KEY, () => {
    if (!unsaved) store.set({ ready: true, settings: repo.load() });
  });
  return { ready: true, settings: repo.load() };
});

export function useSettings(): State {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** The settings as they are NOW, outside React: for code that must see a
    change made while it runs (a turn reads the permission mode at every
    tool call). */
export function currentSettings(): Settings {
  return store.get().settings;
}

export function updateSettings(patch: (prev: Settings) => Settings) {
  const current = store.get().settings;
  const next = patch(unsaved ? current : repo.load());
  unsaved = !repo.save(next);
  store.set({ ready: true, settings: next });
}
