import type { Tool } from "../types";
import { fail, ok } from "../types";
import { exchangeInfo } from "./catalog";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, futuresActionError, resolve, symbolOn } from "./common";

/* SetLeverage: the leverage (and the margin mode) of a futures pair. Gated. */

type Args = { account?: string; symbol: string; leverage: number; marginMode?: "isolated" | "cross" };

/** Some exchanges refuse to "change" a mode already in place: that is not
    an error for us. */
const ALREADY = /no need to change|already|not modified|same as/i;

export const setLeverageTool: Tool<Args> = {
  name: "SetLeverage",
  description: "Sets the leverage of a futures pair (1 to 125), and the margin mode (`isolated` or `cross`) if given. The leverage applies to subsequent orders.",
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
    const readOnly = futuresActionError(r.account, "futures");
    if (readOnly) return fail(readOnly);
    const s = symbolOn(r.ex, args.symbol, "futures");
    if ("error" in s) return fail(s.error);
    if (args.marginMode && !r.ex.has["setMarginMode"]) {
      const label = exchangeInfo(r.account.exchange)?.label ?? r.ex.id;
      return fail(`${label} does not allow changing the margin mode through the API: set it on the exchange, then run again without \`marginMode\`.`);
    }
    return attempt(async () => {
      if (args.marginMode) {
        try {
          await r.ex.setMarginMode(args.marginMode, s.symbol);
        } catch (e) {
          if (!(e instanceof Error && ALREADY.test(e.message))) throw e;
        }
      }
      await r.ex.setLeverage(args.leverage, s.symbol);
      return ok(`${s.symbol}: leverage ×${args.leverage}${args.marginMode ? ` (${args.marginMode})` : ""}.`);
    });
  },
};
