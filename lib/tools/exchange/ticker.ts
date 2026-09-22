import type { Exchange, FundingRate, OrderBook, Ticker } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, symbolOn, type BaseArgs } from "./common";
import { formatTicker } from "./format";

/* ExchangeTicker: the price ON THE EXCHANGE where we trade (BytNode gives
   the market in general; here it is the order book that will execute the
   order). The book and the funding are extras: if they fail, the ticker is
   enough. */

type Args = BaseArgs & { symbol: string; depth?: number };

export const tickerTool: Tool<Args> = {
  name: "ExchangeTicker",
  description: "The price of a pair on the account's exchange: last, bid/ask, 24 h change, volume; the order book (`depth` levels, default 5); on futures, the funding rate. Read-only, no permission needed.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      depth: { type: "integer", minimum: 0, maximum: 50, description: "Order book levels to return (0: none). Default 5." },
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
        /* Each exchange has its own depths: KuCoin accepts only 20 or 100,
           Binance fixed steps (5, 10, 20, 50, 100…), Bybit 1 to 200. 20
           and 100 are accepted everywhere; we keep `depth` levels. If even
           that is refused, without a limit; otherwise, the price is
           enough. */
        const raw = await orderBook(r.ex, s.symbol, depth <= 20 ? 20 : 100);
        if (raw) book = { ...raw, bids: raw.bids.slice(0, depth), asks: raw.asks.slice(0, depth) };
      }
      if (r.market === "futures" && r.ex.has["fetchFundingRate"]) {
        try {
          funding = (await r.ex.fetchFundingRate(s.symbol)) as FundingRate;
        } catch {
          /* same */
        }
      }
      /* Some futures tickers have no bid/ask: the order book has them. */
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
