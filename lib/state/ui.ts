"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

/* Les preferences d'ecran : la largeur de la colonne, et si elle est
   repliee. Rien de plus — ce n'est pas un reglage, c'est une habitude. */

export type UiPrefs = { sidebarWidth: number; sidebarCollapsed: boolean };

const KEY = "agentchat:ui";
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 320;

const storage = new BrowserStorage();
const defaults: UiPrefs = { sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: false };

const store = createStore<UiPrefs>(defaults, () => {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "{}") as Partial<UiPrefs>;
    return {
      sidebarWidth: clampWidth(typeof raw.sidebarWidth === "number" ? raw.sidebarWidth : SIDEBAR_DEFAULT),
      sidebarCollapsed: raw.sidebarCollapsed === true,
    };
  } catch {
    return defaults;
  }
});

export const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function updateUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...store.get(), ...patch };
  storage.set(KEY, JSON.stringify(next));
  store.set(next);
}
