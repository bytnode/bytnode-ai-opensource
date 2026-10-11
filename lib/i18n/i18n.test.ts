import { describe, expect, test } from "vitest";
import { LOCALES, isLocale } from "./locales";
import { currentLocale, currentMessages, dateTag, loadLocale, numberTag } from "./store";
import { en } from "./messages/en";
import { fr } from "./messages/fr";
import { es } from "./messages/es";
import { zh } from "./messages/zh";

/* Every key of every language, as a list of paths: the type system already
   refuses a missing key, this also catches an empty string. */
function leaves(o: unknown, at = ""): Array<[string, unknown]> {
  if (typeof o !== "object" || o === null) return [[at, o]];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, at ? `${at}.${k}` : k));
}

describe("languages", () => {
  test("four, English first", () => {
    expect(LOCALES).toEqual(["en", "fr", "es", "zh"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("it")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  test("every language has every English key, none empty", () => {
    const reference = new Map(leaves(en));
    const keys = [...reference.keys()];
    for (const messages of [fr, es, zh]) {
      const own = leaves(messages);
      expect(own.map(([k]) => k)).toEqual(keys);
      for (const [k, v] of own) {
        /* A plugin that stores nothing: `data: null`, in every language. */
        if (reference.get(k) === null) expect(v, k).toBeNull();
        else if (typeof v === "string") expect(v.trim(), k).not.toBe("");
        else expect(typeof v, k).toBe("function");
      }
    }
  });

  test("a message with a value is a function in every language", () => {
    const fns = leaves(en).filter(([, v]) => typeof v === "function").map(([k]) => k);
    for (const messages of [fr, es, zh]) {
      const own = new Map(leaves(messages));
      for (const k of fns) expect(typeof own.get(k), k).toBe("function");
    }
  });

  test("loading a language switches the words and the formats; the last request wins", async () => {
    expect(currentLocale()).toBe("en");
    expect(numberTag()).toBe("en-US");
    await loadLocale("fr");
    expect(currentMessages().common.cancel).toBe("Annuler");
    expect(dateTag()).toBe("fr-FR");
    const a = loadLocale("es");
    const b = loadLocale("zh");
    await Promise.all([a, b]);
    expect(currentLocale()).toBe("zh");
    expect(numberTag()).toBe("zh-CN");
    await loadLocale("en");
    expect(currentMessages()).toBe(en);
  });
});
