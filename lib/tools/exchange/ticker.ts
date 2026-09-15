import type { Exchange, FundingRate, OrderBook, Ticker } from "ccxt";
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
        /* Chaque exchange a ses profondeurs : KuCoin n'accepte que 20 ou
           100, Binance des paliers (5, 10, 20, 50, 100…), Bybit 1 a 200.
           20 et 100 sont acceptes partout ; on garde `depth` niveaux. Si
           meme cela est refuse, sans limite ; sinon, le prix suffit. */
        const raw = await orderBook(r.ex, s.symbol, depth <= 20 ? 20 : 100);
        if (raw) book = { ...raw, bids: raw.bids.slice(0, depth), asks: raw.asks.slice(0, depth) };
      }
      if (r.market === "futures" && r.ex.has["fetchFundingRate"]) {
        try {
          funding = (await r.ex.fetchFundingRate(s.symbol)) as FundingRate;
        } catch {
          /* idem */
        }
      }
      /* Certains tickers futures n'ont pas de bid/ask : le carnet les a. */
      if (book) {
        if (ticker.bid == null && book.bids[0]) ticker.bid = Number(book.bids[0][0]);
        if (ticker.ask == null && book.asks[0]) ticker.ask = Number(book.asks[0][0]);
      }
      return ok(formatTicker(ticker, book, funding));
    });
  },
};

async function orderBook(ex: Exchange, symbol: string, limit: number): Promise<OrderBook | undefined> {
  try {
    return (await ex.fetchOrderBook(symbol, limit)) as OrderBook;
  } catch {
    try {
      return (await ex.fetchOrderBook(symbol)) as OrderBook;
    } catch {
      return undefined;
    }
  }
}
