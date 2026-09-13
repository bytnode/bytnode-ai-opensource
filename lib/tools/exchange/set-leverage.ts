import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, resolve, symbolOn } from "./common";

/* SetLeverage : le levier (et le mode de marge) d'une paire futures. Gated. */

type Args = { account?: string; symbol: string; leverage: number; marginMode?: "isolated" | "cross" };

/** Certains exchanges refusent de « changer » un mode deja en place :
    ce n'est pas une erreur pour nous. */
const ALREADY = /no need to change|already|not modified|same as/i;

export const setLeverageTool: Tool<Args> = {
  name: "SetLeverage",
  description: "Règle le levier d'une paire futures (1 à 125), et le mode de marge (`isolated` ou `cross`) si donné. Le levier s'applique aux ordres suivants.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      leverage: { type: "integer", minimum: 1, maximum: 125 },
      marginMode: { type: "string", enum: ["isolated", "cross"] },
      account: ACCOUNT_PROP,
    },
    required: ["symbol", "leverage"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx, "futures");
    if ("error" in r) return fail(r.error);
    const s = symbolOn(r.ex, args.symbol, "futures");
    if ("error" in s) return fail(s.error);
    return attempt(async () => {
      if (args.marginMode) {
        try {
          await r.ex.setMarginMode(args.marginMode, s.symbol);
        } catch (e) {
          if (!(e instanceof Error && ALREADY.test(e.message))) throw e;
        }
      }
      await r.ex.setLeverage(args.leverage, s.symbol);
      return ok(`${s.symbol} : levier ×${args.leverage}${args.marginMode ? ` (${args.marginMode})` : ""}.`);
    });
  },
};
