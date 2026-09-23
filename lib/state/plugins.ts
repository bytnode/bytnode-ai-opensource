"use client";

import { useSyncExternalStore } from "react";
import type { AppNotification, PluginStatus } from "@/lib/domain/plugins";
import { fetchNotifications, fetchPlugins, updateNotifications, type PluginToolInfo } from "@/lib/plugins/client";
import { createStore } from "./store";

/* ---------------------------------------------------------------------------
   What the browser knows of the running plugins — their state and their
   tools, for the library — and of the notifications. Refreshed by the app
   shell (session sync, polling); read anywhere.
--------------------------------------------------------------------------- */

type Plugins = { loaded: boolean; status: PluginStatus[]; tools: PluginToolInfo[] };

const plugins = createStore<Plugins>({ loaded: false, status: [], tools: [] });

export const usePlugins = (): Plugins => useSyncExternalStore(plugins.subscribe, plugins.get, plugins.getServer);

export const setPluginStatus = (status: PluginStatus[]) => plugins.set((p) => ({ ...p, status }));

export async function refreshPlugins(): Promise<void> {
  try {
    plugins.set({ loaded: true, ...(await fetchPlugins()) });
  } catch {
    /* the server will answer at the next refresh */
  }
}

const notifications = createStore<AppNotification[]>([]);

export const useNotifications = (): AppNotification[] => useSyncExternalStore(notifications.subscribe, notifications.get, notifications.getServer);

/** Reads the list; returns the ones not seen before (for the browser's own
    notification). */
export async function refreshNotifications(): Promise<AppNotification[]> {
  try {
    const before = new Set(notifications.get().map((n) => n.id));
    const list = await fetchNotifications();
    notifications.set(list);
    return list.filter((n) => !before.has(n.id));
  } catch {
    return [];
  }
}

export async function changeNotifications(change: { read?: string[] | "all"; remove?: string[] | "all" }): Promise<void> {
  try {
    notifications.set(await updateNotifications(change));
  } catch {
    /* unchanged */
  }
}
