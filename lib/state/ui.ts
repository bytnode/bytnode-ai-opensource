"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

/* Screen preferences: the column's width, and whether it is collapsed;
   the width of the Calendar tab's month column and of the Watchlist tab's
   list. Nothing more — this is
   not a setting, it is a habit. */

export type UiPrefs = { sidebarWidth: number; sidebarCollapsed: boolean; calendarWidth: number; watchlistWidth: number };

const KEY = "agentchat:ui";
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 320;
export const CALENDAR_MIN = 300;
export const CALENDAR_MAX = 640;
export const CALENDAR_DEFAULT = 390;
export const WATCHLIST_MIN = 290;
export const WATCHLIST_MAX = 560;
export const WATCHLIST_DEFAULT = 370;

const storage = new BrowserStorage();
const defaults: UiPrefs = { sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: false, calendarWidth: CALENDAR_DEFAULT, watchlistWidth: WATCHLIST_DEFAULT };

const store = createStore<UiPrefs>(defaults, () => {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "{}") as Partial<UiPrefs>;
    return {
      sidebarWidth: clampWidth(typeof raw.sidebarWidth === "number" ? raw.sidebarWidth : SIDEBAR_DEFAULT),
      sidebarCollapsed: raw.sidebarCollapsed === true,
      calendarWidth: clampCalendarWidth(typeof raw.calendarWidth === "number" ? raw.calendarWidth : CALENDAR_DEFAULT),
      watchlistWidth: clampWatchlistWidth(typeof raw.watchlistWidth === "number" ? raw.watchlistWidth : WATCHLIST_DEFAULT),
    };
  } catch {
    return defaults;
  }
});

export const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
export const clampCalendarWidth = (w: number) => Math.min(CALENDAR_MAX, Math.max(CALENDAR_MIN, Math.round(w)));
export const clampWatchlistWidth = (w: number) => Math.min(WATCHLIST_MAX, Math.max(WATCHLIST_MIN, Math.round(w)));

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function updateUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...store.get(), ...patch };
  storage.set(KEY, JSON.stringify(next));
  store.set(next);
}
