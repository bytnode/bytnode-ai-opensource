import { describe, expect, it } from "vitest";
import { EMPTY, editWatchlist, watchlistPrompt } from "./list";

const now = new Date("2026-09-23T10:00:00Z");

describe("editWatchlist", () => {
  it("adds once, updates the note, removes", () => {
    let r = editWatchlist(EMPTY, { add: ["btc", "ETHUSDT"], note: "core", tags: ["Majors"] }, now);
    expect(r.added).toEqual(["BTC/USDT", "ETH/USDT"]);
    expect(r.list.items[0]).toEqual({ symbol: "BTC/USDT", note: "core", tags: ["majors"], addedAt: now.toISOString() });
    r = editWatchlist(r.list, { add: ["BTC/USDT"], note: "long-term" }, now);
    expect(r.added).toEqual([]);
    expect(r.list.items).toHaveLength(2);
    expect(r.list.items[0].note).toBe("long-term");
    r = editWatchlist(r.list, { remove: ["btcusdt", "DOGE"] }, now);
    expect(r.removed).toEqual(["BTC/USDT"]);
    expect(r.invalid).toEqual(["DOGE"]);
    expect(r.list.items.map((x) => x.symbol)).toEqual(["ETH/USDT"]);
  });

  it("does not change the list it was given", () => {
    const list = { items: [{ symbol: "BTC/USDT", addedAt: "x" }] };
    editWatchlist(list, { add: ["eth"], remove: ["btc"] }, now);
    expect(list.items).toEqual([{ symbol: "BTC/USDT", addedAt: "x" }]);
  });

  it("names the symbols for the prompt", () => {
    expect(watchlistPrompt(EMPTY)).toMatch(/empty/);
    const { list } = editWatchlist(EMPTY, { add: ["btc", "eth"] }, now);
    expect(watchlistPrompt(list)).toMatch(/BTC\/USDT, ETH\/USDT\./);
  });
});
