import type { WatchItem } from "./list";

/* What the watchlist offers the plugins that depend on it (alerts, the
   calendar): its symbols, re-read from disk at every call. */
export type WatchlistService = {
  items(): Promise<WatchItem[]>;
  symbols(): Promise<string[]>;
};
