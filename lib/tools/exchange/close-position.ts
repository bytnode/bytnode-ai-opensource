import type { Order, Position } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, contractSizeOf, futuresActionError, hedgeModeError, orderClientId, resolve, sendOnce, symbolOn } from "./common";
import { n8 } from "./format";

/* ClosePosition: closes all or part of a futures position with an opposite
   market order, reduceOnly. ALWAYS asks (`ALWAYS_ASK`). The order is sent
   ONCE (`sendOnce`): a lost answer is an unknown outcome, never a retry. */

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
      /* ⚠️ The order is counted in CONTRACTS, like the position: on OKX,
         Gate, KuCoin or HTX futures one contract is a fraction of the base
         asset, and sending the base quantity closed 1 % of the position. */
      const market = r.ex.markets?.[symbol] as { contractSize?: number; base?: string } | undefined;
      const cs = typeof p.contractSize === "number" && p.contractSize > 0 ? p.contractSize : contractSizeOf(market);
      const contracts = Number(r.ex.amountToPrecision(symbol, (p.contracts ?? 0) * fraction));
      if (!(contracts > 0)) return fail(`Fraction ${fraction} gives a zero quantity after rounding.`);
      const size = cs === 1 ? n8(contracts) : `${n8(contracts * cs)} ${market?.base ?? "base"} = ${n8(contracts)} contract${contracts === 1 ? "" : "s"}`;
      const side = p.side === "long" ? "sell" : "buy";
      const params: Record<string, unknown> = { reduceOnly: true };
      const clientOrderId = orderClientId(r.ex.id, "futures");
      if (clientOrderId) params.clientOrderId = clientOrderId;
      const o = await sendOnce(
        () => r.ex.createOrder(symbol, "market", side, contracts, undefined, params) as Promise<Order>,
        (detail) =>
          `Outcome UNKNOWN: the close order on ${symbol} (${side.toUpperCase()} ${size}, reduce-only${clientOrderId ? `, client id ${clientOrderId}` : ""}) was sent, but the exchange's answer was lost — ${detail} ` +
          `The position may already be closed. Do NOT close again: first check ExchangePositions on ${symbol}, and ExchangeOrders (status "closed")${clientOrderId ? ` for client id ${clientOrderId}` : ""}.`,
      );
      return ok(`Position ${symbol} ${(p.side ?? "?").toUpperCase()} closed at ${Math.round(fraction * 100)} % (${size}) · order #${o.id} ${o.status ?? "sent"}`);
    });
  },
};
