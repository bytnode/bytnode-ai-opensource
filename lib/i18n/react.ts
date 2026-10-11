"use client";

import { useEffect, useSyncExternalStore } from "react";
import { en, type Messages } from "./messages/en";
import { HTML_LANG, type Locale } from "./locales";
import { loadLocale, snapshot, subscribe } from "./store";

/** The interface's words in the current language; renders again when it
    changes. `m.chat.send`, `m.chat.welcome(name)`. */
export function useMessages(): Messages {
  return useSyncExternalStore(
    subscribe,
    () => snapshot().messages,
    () => en,
  );
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    subscribe,
    () => snapshot().locale,
    () => "en" as Locale,
  );
}

/* The page's single writer: loads the chosen language and sets `<html
   lang>`. True once the first language is in place — the page shows
   nothing before, so it never flashes in English.
   A later change keeps the page up: the old words stay until the new ones
   arrive (a step of the setup must not be unmounted, it holds a draft). */
export function useLanguage(locale: Locale): boolean {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void loadLocale(locale);
  }, [locale]);
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[state.locale];
  }, [state.locale]);
  return state.booted || state.locale === locale;
}
