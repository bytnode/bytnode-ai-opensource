"use client";

import { useSyncExternalStore } from "react";
import type { Settings } from "@/lib/domain/types";
import { SettingsRepository, defaultSettings } from "@/lib/storage/repositories";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

type State = { ready: boolean; settings: Settings };

const repo = new SettingsRepository(new BrowserStorage());

const store = createStore<State>({ ready: false, settings: defaultSettings() }, () => ({
  ready: true,
  settings: repo.load(),
}));

export function useSettings(): State {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function updateSettings(patch: (prev: Settings) => Settings) {
  const next = patch(store.get().settings);
  repo.save(next);
  store.set({ ready: true, settings: next });
}
