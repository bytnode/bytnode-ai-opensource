/* ---------------------------------------------------------------------------
   The app's languages (2026-10-10, user request): English first — the
   default — then French, Spanish and Mandarin Chinese (Simplified). Only
   the INTERFACE follows this choice: the agents answer in the language the
   user writes in, whatever it is (`lib/agent/prompt.ts`,
   `lib/acp/prompt.ts`).
--------------------------------------------------------------------------- */

export const LOCALES = ["en", "fr", "es", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own words: that is how a reader finds theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  zh: "中文（简体）",
};

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** `<html lang>`: Simplified Chinese. */
export const HTML_LANG: Record<Locale, string> = { en: "en", fr: "fr", es: "es", zh: "zh-Hans" };

/* What `Intl` formats numbers and dates with. English keeps what the app
   always showed (US numbers, British dates: « 9 Oct »). */
export const NUMBER_TAG: Record<Locale, string> = { en: "en-US", fr: "fr-FR", es: "es-ES", zh: "zh-CN" };
export const DATE_TAG: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", es: "es-ES", zh: "zh-CN" };
