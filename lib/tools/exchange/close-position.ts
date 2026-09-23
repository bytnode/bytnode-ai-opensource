import type { Order, Position } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, futuresActionError, hedgeModeError, resolve, symbolOn } from "./common";
import { n8, positionSize } from "./format";

/* ClosePosition: closes all or part of a futures position with an opposite
   market order, reduceOnly. ALWAYS asks (`ALWAYS_ASK`). */

type Args = { account?: string; symbol: string; fraction?: number };

export const closePositionTool: Tool<Args> = {
  name: "ClosePosition",
  policy: { alwaysAsk: true },
  description: "Closes a futures position (all of it, or a `fraction` from 0.01 to 1) with an opposite reduce-only market order. The user must authorize each close.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      fraction: { type: "number", minimum: 0.01, maximum: 1, description: "Share of the position to close (default 1 = all)." },
      account: ACCOUNT_PROP,
    },
    required: ["symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx, "futures");
    if ("error" in r) return fail(r.error);
    const readOnly = futuresActionError(r.account, "futures");
    if (readOnly) return fail(readOnly);
    const s = symbolOn(r.ex, args.symbol, "futures");
    if ("error" in s) return fail(s.error);
    const symbol = s.symbol;
    const fraction = args.fraction ?? 1;
    return attempt(async () => {
      const hedge = await hedgeModeError(r.ex, symbol);
      if (hedge) return fail(hedge);
      const positions = (await r.ex.fetchPositions([symbol])) as Position[];
      const p = positions.find((x) => x.symbol === symbol && (x.contracts ?? 0) > 0);
      if (!p) return fail(`No open position on ${symbol}.`);
      const amount = Number(r.ex.amountToPrecision(symbol, positionSize(p) * fraction));
      if (!(amount > 0)) return fail(`Fraction ${fraction} gives a zero quantity after rounding.`);
      const side = p.side === "long" ? "sell" : "buy";
      const o = (await r.ex.createOrder(symbol, "market", side, amount, undefined, { reduceOnly: true })) as Order;
      return ok(`Position ${symbol} ${(p.side ?? "?").toUpperCase()} closed at ${Math.round(fraction * 100)} % (${n8(amount)}) · order #${o.id} ${o.status ?? "sent"}`);
    });
  },
};
