import { toSymbol } from "@/lib/tools/exchange/symbols";

/* ---------------------------------------------------------------------------
   The watchlist: the assets the user follows, one list for the whole app.

   Every symbol is normalized so that "btc", "BTC/USDT" and "BTCUSDT" are
   the same entry: a bare asset is quoted in USDT, the market's reference.
   Pure, tested.
--------------------------------------------------------------------------- */

export type WatchItem = { symbol: string; note?: string; tags?: string[]; addedAt: string };

export type Watchlist = { items: WatchItem[] };

export const EMPTY: Watchlist = { items: [] };

const MAX_ITEMS = 100;

/** A symbol in its one form, or null when it cannot be one. */
export function normalizeSymbol(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}([/-]?[A-Z0-9]{2,10})?(:[A-Z0-9]+)?$/.test(t)) return null;
  const pair = toSymbol(t.replace("-", "/"), "spot");
  return pair.includes("/") ? pair : `${pair}/USDT`;
}

export type EditResult = { list: Watchlist; added: string[]; removed: string[]; invalid: string[] };

/** Adds (or updates the note and tags of) and removes symbols. */
export function editWatchlist(list: Watchlist, change: { add?: string[]; remove?: string[]; note?: string; tags?: string[] }, now: Date): EditResult {
  const items = list.items.slice();
  const added: string[] = [];
  const removed: string[] = [];
  const invalid: string[] = [];
  for (const raw of change.remove ?? []) {
    const symbol = normalizeSymbol(raw);
    const i = symbol ? items.findIndex((x) => x.symbol === symbol) : -1;
    if (i >= 0) removed.push(...items.splice(i, 1).map((x) => x.symbol));
    else invalid.push(raw);
  }
  for (const raw of change.add ?? []) {
    const symbol = normalizeSymbol(raw);
    if (!symbol) {
      invalid.push(raw);
      continue;
    }
    const tags = change.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const existing = items.find((x) => x.symbol === symbol);
    if (existing) {
      if (change.note !== undefined) existing.note = change.note.trim() || undefined;
      if (tags?.length) existing.tags = [...new Set([...(existing.tags ?? []), ...tags])];
      continue;
    }
    if (items.length >= MAX_ITEMS) {
      invalid.push(raw);
      continue;
    }
    items.push({ symbol, ...(change.note?.trim() ? { note: change.note.trim() } : {}), ...(tags?.length ? { tags } : {}), addedAt: now.toISOString() });
    added.push(symbol);
  }
  return { list: { items }, added, removed, invalid };
}

/** The line the agents read in their prompt. */
export function watchlistPrompt(list: Watchlist): string {
  if (list.items.length === 0) return "Watchlist: empty. When the user mentions following an asset, WatchlistEdit adds it.";
  const shown = list.items.slice(0, 40).map((x) => x.symbol);
  const more = list.items.length - shown.length;
  return `The user's watchlist ("my watchlist", "my assets"): ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}. WatchlistShow gives their prices and changes; WatchlistEdit adds or removes.`;
}
