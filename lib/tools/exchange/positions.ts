import type { Position } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, resolve, symbolOn } from "./common";
import { formatPositions } from "./format";

/* ExchangePositions : les positions futures ouvertes. Toujours sur le
   marche futures — le spot n'a pas de positions. Lecture seule. */

type Args = { account?: string; symbol?: string };

export const positionsTool: Tool<Args> = {
  name: "ExchangePositions",
  description: "Les positions futures ouvertes d'un compte : côté, taille, prix d'entrée, mark, PnL latent, levier, prix de liquidation. Lecture seule, sans permission.",
  parameters: { type: "object", properties: { account: ACCOUNT_PROP, symbol: { ...SYMBOL_PROP, description: "Limiter à une paire (optionnel)." } }, additionalProperties: false },
  async execute(args, ctx) {
    const r = await resolve(args, ctx, "futures");
    if ("error" in r) return fail(r.error);
    if (!r.ex.has["fetchPositions"]) return fail("Cet exchange ne publie pas les positions via ccxt.");
    let symbols: string[] | undefined;
    if (args.symbol) {
      const s = symbolOn(r.ex, args.symbol, "futures");
      if ("error" in s) return fail(s.error);
      symbols = [s.symbol];
    }
    return attempt(async () => ok(formatPositions((await r.ex.fetchPositions(symbols)) as Position[])));
  },
};
