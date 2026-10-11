import { en, type Messages } from "./messages/en";
import { DATE_TAG, NUMBER_TAG, type Locale } from "./locales";

/* ---------------------------------------------------------------------------
   The interface's words, in the chosen language.

   English is always there (it is the default, and what the server renders);
   the other three are loaded the first time they are chosen, so the page
   carries only the language it shows. `currentMessages()` serves the code
   outside React (a status computed in a plugin's helper); components read
   them with `useMessages()` (`react.ts`), which renders again on a change.

   Text the AGENT reads (prompts, tool results, skills) is not here: it stays
   in English, and the agent answers in the user's language.
--------------------------------------------------------------------------- */

type State = { locale: Locale; messages: Messages; booted: boolean };

let state: State = { locale: "en", messages: en, booted: false };
const loaded = new Map<Locale, Messages>([["en", en]]);
const listeners = new Set<() => void>();

export const snapshot = (): State => state;
export const currentLocale = (): Locale => state.locale;
export const currentMessages = (): Messages => state.messages;

/** What `toLocaleString` / `toLocaleDateString` take, in the current language. */
export const numberTag = (): string => NUMBER_TAG[state.locale];
export const dateTag = (): string => DATE_TAG[state.locale];

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function importMessages(locale: Locale): Promise<Messages> {
  switch (locale) {
    case "fr":
      return import("./messages/fr").then((m) => m.fr);
    case "es":
      return import("./messages/es").then((m) => m.es);
    case "zh":
      return import("./messages/zh").then((m) => m.zh);
    default:
      return Promise.resolve(en);
  }
}

/* Two quick changes: only the last one is applied, whichever loads first. */
let wanted: Locale = "en";

export async function loadLocale(locale: Locale): Promise<void> {
  wanted = locale;
  let messages = loaded.get(locale);
  if (!messages) {
    try {
      messages = await importMessages(locale);
    } catch {
      /* A chunk that cannot load (an app updated under an open window):
         English rather than nothing. */
      messages = en;
    }
    loaded.set(locale, messages);
  }
  if (wanted !== locale) return;
  state = { locale, messages, booted: true };
  for (const l of listeners) l();
}
