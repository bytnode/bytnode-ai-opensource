import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import { n8, signedPct } from "../shared/format";
import { isQuote, quotes } from "../shared/prices";
import { normalizeSymbol } from "../shared/quote";
import type { WatchItem } from "./list";

/* WatchlistShow: the list, priced — BytNode first, the exchange otherwise,
   each figure with its source and its time. */

type Args = { symbols?: string[] };

const change = (n: number | undefined) => (n === undefined ? "—" : signedPct(n));

export function watchlistShowTool(read: () => Promise<WatchItem[]>): Tool<Args> {
  return {
    name: "WatchlistShow",
    policy: { readOnly: true, subagent: true },
    description:
      "The user's watchlist with, for each asset, its price and its 24 h and 7 d changes (BytNode, else the exchange of one of their accounts), the source and the time of each reading. `symbols` limits it to a few. Use it for \"my watchlist\", \"my assets\", \"how are my coins doing\".",
    parameters: {
      type: "object",
      properties: { symbols: { type: "array", items: { type: "string" }, description: "Only these symbols (optional)." } },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const all = await read();
      const asked = new Set((args.symbols ?? []).map(normalizeSymbol).filter((s): s is string => s !== null));
      const wanted = asked.size ? all.filter((x) => asked.has(x.symbol)) : all;
      if (all.length === 0) return ok("The watchlist is empty. Offer to add assets with WatchlistEdit.");
      if (wanted.length === 0) return ok(`None of these is in the watchlist. It holds: ${all.map((x) => x.symbol).join(", ")}.`);
      const priced = await quotes(
        wanted.map((x) => x.symbol),
        { bytnodeKey: ctx.bytnodeKey, accounts: ctx.exchangeAccounts, signal: ctx.signal },
      );
      const rows = wanted.map((x) => {
        const p = priced.get(x.symbol)!;
        return isQuote(p) ? [x.symbol, n8(p.price), change(p.change24h), change(p.change7d), `${p.source} ${p.at.slice(11, 16)}Z`] : [x.symbol, "—", "—", "—", p.error];
      });
      const lines = rows.map(([s, price, d, w, src]) => `${s}: ${price} · 24 h ${d} · 7 d ${w} · ${src}`);
      const notes = wanted.filter((x) => x.note).map((x) => `${x.symbol}: ${x.note}`);
      return {
        ...ok([`Watchlist (${wanted.length} asset${wanted.length > 1 ? "s" : ""}), read ${new Date().toISOString().slice(0, 16)}Z:`, ...lines, ...(notes.length ? ["Notes:", ...notes] : [])].join("\n")),
        card: tableCard("Watchlist", ["Asset", "Price", "24 h", "7 d", "Source"], rows),
      };
    },
  };
}
