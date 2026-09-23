"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

/* ---------------------------------------------------------------------------
   The tab bar: the home tab (the conversations) and one tab per open view.

   No duplicates — opening an open view switches to it (with the new
   parameters); the tabs come back after a reload; closing the active one
   falls back on its left neighbour, then on the home tab. A tab whose
   plugin is off is simply not shown (and pruned when it is switched off).
--------------------------------------------------------------------------- */

export const HOME = "home";

export type ViewTab = { view: string; params?: Record<string, unknown> };
export type TabsState = { open: ViewTab[]; active: string };

const KEY = "agentchat:tabs";
const storage = new BrowserStorage();
const empty: TabsState = { open: [], active: HOME };

const store = createStore<TabsState>(empty, () => {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "{}") as Partial<TabsState>;
    const open = Array.isArray(raw.open) ? raw.open.filter((t): t is ViewTab => typeof t?.view === "string") : [];
    const active = typeof raw.active === "string" && (raw.active === HOME || open.some((t) => t.view === raw.active)) ? raw.active : HOME;
    return { open, active };
  } catch {
    return empty;
  }
});

function save(next: TabsState) {
  storage.set(KEY, JSON.stringify(next));
  store.set(next);
}

export const useTabs = (): TabsState => useSyncExternalStore(store.subscribe, store.get, store.getServer);

/** Pure: the state after opening a view. */
export function withView(state: TabsState, view: string, params?: Record<string, unknown>): TabsState {
  const tab: ViewTab = params && Object.keys(params).length ? { view, params } : { view };
  const exists = state.open.some((t) => t.view === view);
  return { open: exists ? state.open.map((t) => (t.view === view ? tab : t)) : [...state.open, tab], active: view };
}

/** Pure: the state after closing views. */
export function withoutViews(state: TabsState, views: string[]): TabsState {
  const open = state.open.filter((t) => !views.includes(t.view));
  if (!views.includes(state.active)) return { open, active: state.active };
  const i = state.open.findIndex((t) => t.view === state.active);
  const left = state.open.slice(0, i).reverse().find((t) => !views.includes(t.view));
  return { open, active: left?.view ?? open[0]?.view ?? HOME };
}

export const openView = (view: string, params?: Record<string, unknown>) => save(withView(store.get(), view, params));
export const closeViews = (views: string[]) => save(withoutViews(store.get(), views));
export const activateTab = (id: string) => save({ ...store.get(), active: id });
