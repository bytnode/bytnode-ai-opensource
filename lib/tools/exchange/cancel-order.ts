import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, symbolOn, type BaseArgs } from "./common";

/* CancelOrder: one order by id, or every order on a pair. Gated. */

type Args = BaseArgs & { orderId?: string; symbol?: string; all?: boolean };

export const cancelOrderTool: Tool<Args> = {
  name: "CancelOrder",
  policy: { gated: true, subagent: false },
  description: "Cancels a pending order (`orderId`, with `symbol` if the exchange requires it) or every order on a pair (`symbol` + `all: true`).",
  parameters: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "The order id (see ExchangeOrders)." },
      symbol: SYMBOL_PROP,
      all: { type: "boolean", description: "True: cancel every order on `symbol`." },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!args.orderId && !(args.all && args.symbol)) return fail("Give `orderId`, or `symbol` with `all: true`.");
    const r = await resolve(args, ctx);
    if ("error" in r) return fail(r.error);
    let symbol: string | undefined;
    if (args.symbol) {
      const s = symbolOn(r.ex, args.symbol, r.market);
      if ("error" in s) return fail(s.error);
      symbol = s.symbol;
    }
    return attempt(async () => {
      if (args.all && symbol) {
        /* OKX and Coinbase have no global cancel: the open orders, one by
           one. */
        if (!r.ex.has["cancelAllOrders"]) {
          const open = (await r.ex.fetchOpenOrders(symbol)) as Array<{ id: string }>;
          for (const o of open) await r.ex.cancelOrder(o.id, symbol);
          return ok(open.length === 0 ? `No open order on ${symbol}.` : `${open.length} order${open.length > 1 ? "s" : ""} canceled on ${symbol}.`);
        }
        const res = await r.ex.cancelAllOrders(symbol);
        const n = Array.isArray(res) ? res.length : null;
        return ok(n === null ? `All ${symbol} orders canceled.` : `${n} order${n > 1 ? "s" : ""} canceled on ${symbol}.`);
      }
      await r.ex.cancelOrder(args.orderId as string, symbol);
      return ok(`Order #${args.orderId} canceled.`);
    });
  },
};
