import type { Order } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, sinceMs, symbolOn, type BaseArgs } from "./common";
import { formatOrders } from "./format";

/* ExchangeOrders: the open orders, or the history (fills, fees).
   Read-only. */

type Args = BaseArgs & { status: "open" | "closed"; symbol?: string; since?: string | number; limit?: number };

export const ordersTool: Tool<Args> = {
  name: "ExchangeOrders",
  description: "An account's orders: `open` (pending) or `closed` (filled / canceled, with average price and fees). Filter by pair and by date. Read-only, no permission needed.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "closed"], description: "`open`: pending orders. `closed`: history." },
      symbol: { ...SYMBOL_PROP, description: "Limit to one pair (often required by the exchange for the history)." },
      since: { type: "string", description: "Only return orders since this date (ISO 8601 or milliseconds)." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum number of orders (default 50)." },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    required: ["status"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx);
    if ("error" in r) return fail(r.error);
    let symbol: string | undefined;
    if (args.symbol) {
      const s = symbolOn(r.ex, args.symbol, r.market);
      if ("error" in s) return fail(s.error);
      symbol = s.symbol;
    }
    const since = sinceMs(args.since);
    const limit = args.limit ?? 50;
    return attempt(async () => {
      let orders: Order[];
      if (args.status === "open") orders = (await r.ex.fetchOpenOrders(symbol, since, limit)) as Order[];
      else if (r.ex.has["fetchClosedOrders"]) orders = (await r.ex.fetchClosedOrders(symbol, since, limit)) as Order[];
      else orders = ((await r.ex.fetchOrders(symbol, since, limit)) as Order[]).filter((o) => o.status !== "open");
      return ok(formatOrders(orders));
    });
  },
};
