"use client";

import { updateSettings } from "@/lib/state/settings";
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/lib/i18n/locales";
import { useMessages } from "@/lib/i18n/react";
import { Select } from "./select";

/* The interface's language, in the setup's first step and in Settings →
   General (2026-10-10). Saved at once, whatever the screen: the page loads
   the words and turns around (Arabic) without losing what is being filled
   in. Each language is named in its own words. */
export function LanguageSelect({ id, value }: { id: string; value: Locale }) {
  const m = useMessages();
  return (
    <Select
      id={id}
      value={value}
      label={m.language.label}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      onChange={(v) => {
        if (isLocale(v)) updateSettings((s) => ({ ...s, language: v }));
      }}
    />
  );
}
