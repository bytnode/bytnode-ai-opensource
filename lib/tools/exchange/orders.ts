import type { Order } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, resolve, sinceMs, symbolOn, type BaseArgs } from "./common";
import { formatOrders } from "./format";

/* ExchangeOrders : les ordres ouverts, ou l'historique (fills, frais).
   Lecture seule. */

type Args = BaseArgs & { status: "open" | "closed"; symbol?: string; since?: string | number; limit?: number };

export const ordersTool: Tool<Args> = {
  name: "ExchangeOrders",
  description: "Les ordres d'un compte : `open` (en attente) ou `closed` (exécutés / annulés, avec prix moyen et frais). Filtre par paire et par date. Lecture seule, sans permission.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "closed"], description: "`open` : ordres en attente. `closed` : historique." },
      symbol: { ...SYMBOL_PROP, description: "Limiter à une paire (souvent exigé par l'exchange pour l'historique)." },
      since: { type: "string", description: "Ne rendre que les ordres depuis cette date (ISO 8601 ou millisecondes)." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Nombre maximum d'ordres (défaut 50)." },
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
