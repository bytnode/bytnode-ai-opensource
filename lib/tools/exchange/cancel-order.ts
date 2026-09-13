import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, symbolOn, type BaseArgs } from "./common";

/* CancelOrder : un ordre par id, ou tous les ordres d'une paire. Gated. */

type Args = BaseArgs & { orderId?: string; symbol?: string; all?: boolean };

export const cancelOrderTool: Tool<Args> = {
  name: "CancelOrder",
  description: "Annule un ordre en attente (`orderId`, avec `symbol` si l'exchange l'exige) ou tous les ordres d'une paire (`symbol` + `all: true`).",
  parameters: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "L'id de l'ordre (voir ExchangeOrders)." },
      symbol: SYMBOL_PROP,
      all: { type: "boolean", description: "Vrai : annuler tous les ordres de `symbol`." },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!args.orderId && !(args.all && args.symbol)) return fail("Donne `orderId`, ou `symbol` avec `all: true`.");
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
        const res = await r.ex.cancelAllOrders(symbol);
        const n = Array.isArray(res) ? res.length : null;
        return ok(n === null ? `Tous les ordres ${symbol} annulés.` : `${n} ordre${n > 1 ? "s" : ""} annulé${n > 1 ? "s" : ""} sur ${symbol}.`);
      }
      await r.ex.cancelOrder(args.orderId as string, symbol);
      return ok(`Ordre #${args.orderId} annulé.`);
    });
  },
};
