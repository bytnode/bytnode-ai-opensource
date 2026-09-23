import { definePlugin } from "../core/contract";
import { isInterval } from "../shared/candle";
import { normalizeSymbol } from "../shared/quote";
import { candles, isQuote, quote, quotes } from "../shared/prices";
import { EMPTY, editWatchlist, watchlistPrompt, type Watchlist } from "./list";
import { watchlistManifest } from "./manifest";
import type { WatchlistService } from "./service";
import { watchlistEditTool } from "./watchlist-edit";
import { watchlistShowTool } from "./watchlist-show";

/* The watchlist: one list for the whole app, on disk
   (`plugins/watchlist/watchlist.json`), read by the agents' prompt, the
   tools, the view, and — through its service — the alerts and the
   calendar. Every change announces `watchlist:changed`. */

const FILE = "watchlist.json";
/** A live price is at most this old: the view reads it every 5 s. */
const LIVE_MS = 4_000;

export const watchlistPlugin = definePlugin({
  manifest: watchlistManifest,
  setup(ctx) {
    const read = async () => (await ctx.store.read<Watchlist>(FILE, EMPTY)).items ?? [];
    const update = (change: (list: Watchlist) => Watchlist) => ctx.store.update<Watchlist>(FILE, EMPTY, change);
    const changed = () => ctx.emit("changed");

    ctx.tool(watchlistShowTool(read));
    ctx.tool(watchlistEditTool(update, changed));
    ctx.prompt(async () => watchlistPrompt({ items: await read() }));
    ctx.provide<WatchlistService>(() => ({ items: read, symbols: async () => (await read()).map((x) => x.symbol) }));

    /* The view: the list priced, and the same edits as the tool. */
    ctx.api("list", async (_params, { transport, signal }) => {
      const items = await read();
      const priced = await quotes(
        items.map((x) => x.symbol),
        { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal },
      );
      return items.map((x) => {
        const p = priced.get(x.symbol);
        return { ...x, quote: p && isQuote(p) ? p : null, error: p && !isQuote(p) ? p.error : null };
      });
    });
    /* The asset the view shows, live: its quote every few seconds, and
       its candles for the chart. */
    ctx.api("price", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      return quote(symbol, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal }, LIVE_MS);
    });
    ctx.api("candles", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const interval = isInterval(params.interval) ? params.interval : "1h";
      const limit = typeof params.limit === "number" ? params.limit : 300;
      return candles(symbol, interval, limit, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal });
    });
    ctx.api("edit", async (params) => {
      const change = {
        add: Array.isArray(params.add) ? params.add.map(String) : undefined,
        remove: Array.isArray(params.remove) ? params.remove.map(String) : undefined,
        note: typeof params.note === "string" ? params.note : undefined,
      };
      let invalid: string[] = [];
      const list = await update((current) => {
        const r = editWatchlist(current, change, new Date());
        invalid = r.invalid;
        return r.list;
      });
      changed();
      return { count: list.items.length, invalid };
    });
  },
});
