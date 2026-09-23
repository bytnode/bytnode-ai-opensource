import { definePlugin } from "../core/contract";
import { readBytnodeTool } from "@/lib/mcp/bytnode";
import { isInterval, readKlines } from "../shared/candle";
import { CORE_FIELDS, PRESSURE_FIELDS, readInsight } from "./insight";
import { INDICATORS, RESULTS, readTechnicals } from "./technicals";
import { bytnodeSymbol, normalizeSymbol } from "../shared/quote";
import { bytnodePairs, candles, isQuote, quote, quotes } from "../shared/prices";
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
    /* What the view tells about the asset under its chart: one BytNode
       call; the open interest is priced with the last hourly close. */
    ctx.api("insight", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const key = transport.bytnodeKey?.trim();
      if (!key) return { symbol, error: "These figures come from BytNode: add your key in Settings → Auth." };
      /* The pull's fields are extras: a pair that refuses them still gets
         its key figures, asked again without them. */
      let res = await readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), ...CORE_FIELDS, ...PRESSURE_FIELDS }, signal);
      if (!res.ok) res = await readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), ...CORE_FIELDS }, signal);
      if (!res.ok) return { symbol, error: res.message };
      try {
        const parsed: unknown = JSON.parse(res.text);
        const last = readKlines(parsed, "klines_1h").at(-1);
        return { symbol, insight: readInsight(parsed, last?.c) };
      } catch {
        return { symbol, error: `BytNode's figures for ${symbol} could not be read.` };
      }
    });
    /* The asset's technical signals on the chart's interval: one call. */
    ctx.api("technicals", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const interval = isInterval(params.interval) ? params.interval : "1h";
      const key = transport.bytnodeKey?.trim();
      if (!key) return { symbol, interval, error: "Signals come from BytNode: add your key in Settings → Auth." };
      const res = await readBytnodeTool(key, "get_market_indicators", { symbol: bytnodeSymbol(symbol), timeframe: interval, results: RESULTS, indicators: INDICATORS }, signal);
      if (!res.ok) return { symbol, interval, error: /symbol|symbole|not supported|inconnu|unknown/i.test(res.message) ? `BytNode computes signals on its perpetual pairs only — not on ${symbol}.` : res.message };
      try {
        return { symbol, interval, technicals: readTechnicals(JSON.parse(res.text)) };
      } catch {
        return { symbol, interval, error: `BytNode's signals for ${symbol} could not be read.` };
      }
    });
    /* What the add field proposes: BytNode's pairs only (ranked in the
       browser, `suggest.ts`). */
    ctx.api("symbols", async (_params, { transport, signal }) => bytnodePairs(transport.bytnodeKey, signal));
    /* The view's edits. An asset added from the view must be one BytNode
       covers — the field offers nothing else, and this holds it server
       side too; the others come back in `invalid`. One already followed
       passes (a note is edited through `add`). (The agents' tool is not
       bound by it.) */
    ctx.api("edit", async (params, { transport, signal }) => {
      let refused: string[] = [];
      let add = Array.isArray(params.add) ? params.add.map(String) : undefined;
      if (add?.length) {
        const covered = new Set((await bytnodePairs(transport.bytnodeKey, signal)).map((x) => x.symbol));
        const followed = new Set((await read()).map((x) => x.symbol));
        refused = add.filter((s) => {
          const symbol = normalizeSymbol(s) ?? "";
          return !covered.has(symbol) && !followed.has(symbol);
        });
        add = add.filter((s) => !refused.includes(s));
      }
      const change = {
        add,
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
      return { count: list.items.length, invalid: [...refused, ...invalid] };
    });
  },
});
