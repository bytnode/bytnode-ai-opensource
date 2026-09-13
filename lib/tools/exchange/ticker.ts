import type { FundingRate, OrderBook, Ticker } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, symbolOn, type BaseArgs } from "./common";
import { formatTicker } from "./format";

/* ExchangeTicker : le prix DE L'EXCHANGE ou l'on trade (BytNode donne le
   marche en general ; ici c'est le carnet qui va executer l'ordre). Le
   carnet et le funding sont des a-cotes : s'ils echouent, le ticker suffit. */

type Args = BaseArgs & { symbol: string; depth?: number };

export const tickerTool: Tool<Args> = {
  name: "ExchangeTicker",
  description: "Le prix d'une paire sur l'exchange du compte : dernier, bid/ask, variation 24 h, volume ; le carnet (`depth` niveaux, défaut 5) ; en futures, le taux de funding. Lecture seule, sans permission.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      depth: { type: "integer", minimum: 0, maximum: 50, description: "Niveaux du carnet à rendre (0 : aucun). Défaut 5." },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    required: ["symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx);
    if ("error" in r) return fail(r.error);
    const s = symbolOn(r.ex, args.symbol, r.market);
    if ("error" in s) return fail(s.error);
    const depth = args.depth ?? 5;
    return attempt(async () => {
      const ticker = (await r.ex.fetchTicker(s.symbol)) as Ticker;
      let book: OrderBook | undefined;
      let funding: FundingRate | undefined;
      if (depth > 0) {
        try {
          book = (await r.ex.fetchOrderBook(s.symbol, depth)) as OrderBook;
        } catch {
          /* le prix suffit */
        }
      }
      if (r.market === "futures" && r.ex.has["fetchFundingRate"]) {
        try {
          funding = (await r.ex.fetchFundingRate(s.symbol)) as FundingRate;
        } catch {
          /* idem */
        }
      }
      return ok(formatTicker(ticker, book, funding));
    });
  },
};
