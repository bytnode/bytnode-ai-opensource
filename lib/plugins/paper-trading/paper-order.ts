import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { factsCard } from "../shared/cards";
import { normalizeSymbol } from "../shared/quote";
import type { Desk } from "./desk";
import { CASH, type OrderType, type PaperMarket, type Side } from "./engine";
import { SIMULATED, fillLine, num, orderLine, signed, usdt } from "./present";

/* PaperOrder: a simulated order, shaped like PlaceOrder (market or limit;
   amount or quoteAmount; futures with leverage and reduce-only). Free to
   use — no money moves — but kept from sub-agents and background runs:
   the simulated portfolio is the user's exercise, not theirs. */

type Args = { symbol: string; side: Side; type: OrderType; amount?: number; quoteAmount?: number; price?: number; market?: PaperMarket; leverage?: number; reduceOnly?: boolean };

export function paperOrderTool(desk: Desk): Tool<Args> {
  return {
    name: "PaperOrder",
    policy: { gated: false, subagent: false },
    description:
      `Places a SIMULATED order in the paper portfolio — no real money, no exchange. Same shape as PlaceOrder: \`market\` or \`limit\` (requires \`price\`), \`amount\` in base asset OR \`quoteAmount\` in ${CASH}; \`market: futures\` for a linear perpetual with \`leverage\` (isolated margin) and \`reduceOnly\`. ` +
      `Pairs are quoted in ${CASH}. Fills at the current BytNode price with the configured fees and slippage; a limit the market has not reached waits and fills at its price. Always tell the user the result is simulated.`,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: `Pair, e.g. BTC/USDT (\"btc\" is understood).` },
        side: { type: "string", enum: ["buy", "sell"] },
        type: { type: "string", enum: ["market", "limit"] },
        amount: { type: "number", minimum: 0, description: "Quantity in base asset." },
        quoteAmount: { type: "number", minimum: 0, description: `Amount in ${CASH}, instead of \`amount\`.` },
        price: { type: "number", minimum: 0, description: "Limit price." },
        market: { type: "string", enum: ["spot", "futures"], description: "Default spot." },
        leverage: { type: "integer", minimum: 1, maximum: 125, description: "Futures: leverage of a new position (default 1)." },
        reduceOnly: { type: "boolean", description: "Futures: only reduce the open position." },
      },
      required: ["symbol", "side", "type"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const symbol = normalizeSymbol(args.symbol);
      if (!symbol) return fail(`Not a pair: ${args.symbol}.`);
      const r = await desk.place({ ...args, symbol, market: args.market ?? "spot" }, { bytnodeKey: ctx.bytnodeKey, accounts: ctx.exchangeAccounts, signal: ctx.signal });
      if ("error" in r) return fail(`Paper order refused: ${r.error}`);
      const { order, fill } = r;
      const status = fill ? `Filled: ${fillLine(fill)}.` : `Open, waiting for ${symbol} to reach ${num(order.price ?? 0)}; its funds are held.`;
      return {
        ...ok(`PAPER order ${orderLine(order)}. ${status} Market price ${num(r.price)} (${r.source}). ${SIMULATED}`),
        card: factsCard(
          "Paper order",
          [
            ["Order", orderLine(order)],
            ["Status", fill ? `filled at ${num(fill.price)}` : `open, limit ${num(order.price ?? 0)}`],
            ...(fill ? ([["Fee", usdt(fill.fee)]] as Array<[string, string]>) : []),
            ...(fill?.realizedPnl ? ([["Realized", signed(fill.realizedPnl)]] as Array<[string, string]>) : []),
            ["Market price", `${num(r.price)} (${r.source})`],
          ],
          { badge: "PAPER", note: SIMULATED },
        ),
      };
    },
  };
}
