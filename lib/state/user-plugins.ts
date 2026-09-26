"use client";

import { useSyncExternalStore } from "react";
import type { PluginManifest } from "@/lib/domain/plugins";
import { fetchUserPlugins } from "@/lib/plugins/client";
import type { UserPluginInfo } from "@/lib/plugins/user/types";
import { createStore } from "./store";

/* ---------------------------------------------------------------------------
   The plugins the user's agents wrote, as the browser knows them: for the
   library, the tabs (their views), the agents' plugin list, and the
   review screen — which is opened from anywhere (a notification, the card
   under an agent's message, the library) and drawn once by the app shell.
   Refreshed with the notifications and after every decision.
--------------------------------------------------------------------------- */

const plugins = createStore<UserPluginInfo[]>([]);

export const useUserPlugins = (): UserPluginInfo[] => useSyncExternalStore(plugins.subscribe, plugins.get, plugins.getServer);

/** The list now, outside React (a request being built). */
export const currentUserPlugins = (): UserPluginInfo[] => plugins.get();

/** The manifests of the ones that run (or are switched off after running):
    what the catalog adds to the shipped ones. */
export const runningManifests = (list: UserPluginInfo[]): PluginManifest[] =>
  list.filter((p) => p.granted && p.manifest && (p.state === "active" || p.state === "error" || p.state === "pending")).map((p) => p.manifest as PluginManifest);

export async function refreshUserPlugins(): Promise<void> {
  try {
    const next = await fetchUserPlugins();
    /* Same content: no new array, no re-render of everything reading it. */
    if (JSON.stringify(next) !== JSON.stringify(plugins.get())) plugins.set(next);
  } catch {
    /* the next refresh will tell */
  }
}

const review = createStore<string | null>(null);

export const useReviewing = (): string | null => useSyncExternalStore(review.subscribe, review.get, review.getServer);

/** Opens the review screen of a plugin waiting for the user. */
export const openReview = (pluginId: string) => {
  review.set(pluginId);
  void refreshUserPlugins();
};

export const closeReview = () => review.set(null);
