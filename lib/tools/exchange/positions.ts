import type { Position } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, resolve, symbolOn } from "./common";
import { formatPositions } from "./format";

/* ExchangePositions: the open futures positions. Always on the futures
   market — spot has no positions. Read-only. */

type Args = { account?: string; symbol?: string };

export const positionsTool: Tool<Args> = {
  name: "ExchangePositions",
  policy: { readOnly: true, subagent: true },
  description: "An account's open futures positions: side, size, entry price, mark, unrealized PnL, leverage, liquidation price. Read-only, no permission needed.",
  parameters: { type: "object", properties: { account: ACCOUNT_PROP, symbol: { ...SYMBOL_PROP, description: "Limit to one pair (optional)." } }, additionalProperties: false },
  async execute(args, ctx) {
    const r = await resolve(args, ctx, "futures");
    if ("error" in r) return fail(r.error);
    if (!r.ex.has["fetchPositions"]) return fail("This exchange does not publish positions through ccxt.");
    let symbols: string[] | undefined;
    if (args.symbol) {
      const s = symbolOn(r.ex, args.symbol, "futures");
      if ("error" in s) return fail(s.error);
      symbols = [s.symbol];
    }
    return attempt(async () => ok(formatPositions((await r.ex.fetchPositions(symbols)) as Position[])));
  },
};
