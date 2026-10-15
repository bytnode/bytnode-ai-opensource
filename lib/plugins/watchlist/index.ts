import { definePlugin } from "../core/contract";
import { restGet, restPost } from "@/lib/bytnode/rest";
import { isInterval, readKlines } from "../shared/candle";
import { LIQUIDATIONS, LIQUIDATIONS_FIELD, SNAPSHOT_FIELDS, readInsight } from "./insight";
import { INDICATORS, RESULTS, readTechnicals } from "./technicals";
import { bytnodeSymbol, normalizeSymbol } from "../shared/quote";
import { bytnodePairs, candles, isQuote, quotes } from "../shared/prices";
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
    /* The chosen asset's candles for the chart (its live price, streamed
       to the view, moves the last one). */
    ctx.api("candles", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const interval = isInterval(params.interval) ? params.interval : "1h";
      const limit = typeof params.limit === "number" ? params.limit : 300;
      return candles(symbol, interval, limit, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal });
    });
    /* What the view tells about the asset under its chart: BytNode's
       snapshot and the day's liquidations, read together (REST); the
       open interest is priced with the last hourly close. */
    ctx.api("insight", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const key = transport.bytnodeKey?.trim();
      if (!key) return { symbol, error: "These figures come from BytNode: add your key in Settings → Auth." };
      const sym = bytnodeSymbol(symbol);
      const [snap, liq] = await Promise.all([
        restGet<Record<string, unknown>>(key, "/v1/snapshot", { symbol: sym, ...SNAPSHOT_FIELDS }, signal),
        restGet<unknown[]>(key, "/v1/liquidations/cumulative/history", { symbol: sym, ...LIQUIDATIONS }, signal),
      ]);
      if (!snap.ok) return { symbol, error: snap.message };
      const data = { ...(snap.data ?? {}), ...(liq.ok && Array.isArray(liq.data) ? { [LIQUIDATIONS_FIELD]: liq.data } : {}) };
      const last = readKlines(data, "klines@1h").at(-1);
      return { symbol, insight: readInsight(data, last?.c) };
    });
    /* The asset's technical signals on the chart's interval: one call. */
    ctx.api("technicals", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return null;
      const interval = isInterval(params.interval) ? params.interval : "1h";
      const key = transport.bytnodeKey?.trim();
      if (!key) return { symbol, interval, error: "Signals come from BytNode: add your key in Settings → Auth." };
      const res = await restPost(key, "/v1/indicators", { symbol: bytnodeSymbol(symbol), timeframe: interval, limit: RESULTS, indicators: INDICATORS }, signal);
      if (!res.ok) return { symbol, interval, error: res.code === "invalid_symbol" ? `BytNode does not compute signals on ${symbol}.` : res.message };
      if (res.data === null || res.data === undefined) return { symbol, interval, error: `BytNode does not compute signals on ${symbol}.` };
      return { symbol, interval, technicals: readTechnicals(res.data) };
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
