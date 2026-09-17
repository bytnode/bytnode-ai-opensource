import { describe, expect, it } from "vitest";
import { addEntry, parseMemory, removeEntry, renderMemoryPrompt, searchEntries, serializeMemory, type MemoryEntry } from "./memory-store";

const e = (id: string, text: string, tags: string[] = [], at = 1_700_000_000_000): MemoryEntry => ({ id, at, text, tags });

describe("memory store", () => {
  it("serialise et relit les entrees (une par ligne, JSON)", () => {
    const entries = [e("a", "BTC : support 60k", ["btc"]), e("b", "Stratégie X ne tient pas hors échantillon")];
    expect(parseMemory(serializeMemory(entries))).toEqual(entries);
  });

  it("ignore les lignes illisibles", () => {
    expect(parseMemory('{"id":"a","at":1,"text":"ok","tags":[]}\nnot json\n')).toEqual([e("a", "ok", [], 1)]);
  });

  it("ajoute avec un id et une date, sans doublon exact", () => {
    const one = addEntry([], "note", ["t"], () => "id1", () => 5);
    expect(one).toEqual([e("id1", "note", ["t"], 5)]);
    expect(addEntry(one, "note", ["t"], () => "id2", () => 6)).toEqual(one);
  });

  it("retire par id", () => {
    expect(removeEntry([e("a", "x"), e("b", "y")], "a")).toEqual([e("b", "y")]);
  });

  it("cherche dans le texte et les tags, insensible a la casse", () => {
    const list = [e("a", "Support BTC 60k", ["btc"]), e("b", "ETH range", ["eth"])];
    expect(searchEntries(list, "btc").map((x) => x.id)).toEqual(["a"]);
    expect(searchEntries(list, "RANGE").map((x) => x.id)).toEqual(["b"]);
  });

  it("rend un bloc de prompt borne aux dernieres entrees", () => {
    const list = Array.from({ length: 50 }, (_, i) => e(`i${i}`, `note ${i}`, [], i));
    const out = renderMemoryPrompt(list, 5);
    expect(out).toContain("note 49");
    expect(out).not.toContain("note 44");
    expect(out).toContain("45 plus anciennes");
  });

  it("sans entree, pas de bloc", () => {
    expect(renderMemoryPrompt([], 5)).toBe("");
  });
});
