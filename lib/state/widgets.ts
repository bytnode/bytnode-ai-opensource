"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { EMPTY_WIDGETS, readWidgets, type WidgetsState } from "@/lib/widgets/catalog";
import { createStore } from "./store";

/* The conversation page's widgets: whether their column is shown, and the
   list, in order — the same in every conversation, whatever the agent (the
   user's choice). A habit, kept in this browser. */

const KEY = "agentchat:widgets";
const storage = new BrowserStorage();

const store = createStore<WidgetsState>(EMPTY_WIDGETS, () => {
  try {
    return readWidgets(JSON.parse(storage.get(KEY) ?? "null"));
  } catch {
    return EMPTY_WIDGETS;
  }
});

export const useWidgets = (): WidgetsState => useSyncExternalStore(store.subscribe, store.get, store.getServer);

export function updateWidgets(next: (prev: WidgetsState) => WidgetsState) {
  const state = next(store.get());
  storage.set(KEY, JSON.stringify(state));
  store.set(state);
}
