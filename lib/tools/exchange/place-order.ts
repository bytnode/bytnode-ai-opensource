import type { Order } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, futuresActionError, hedgeModeError, resolve, symbolOn, triggerDirection, type BaseArgs, type Resolved } from "./common";
import { n8 } from "./format";

/* ---------------------------------------------------------------------------
   PlaceOrder: one order, spot or futures.

   ⚠️ ALWAYS ASKS THE USER'S CONSENT (`ALWAYS_ASK`). Before touching the
   exchange: a single quantity (base or quote), the price the type
   requires, rounding to the market's precision, the minimum, and no hedge
   mode. What is refused here is refused without a call to the exchange.
--------------------------------------------------------------------------- */

type OrderType = "market" | "limit" | "stop" | "stop_limit" | "take_profit";

type Args = BaseArgs & {
  symbol: string;
  side: "buy" | "sell";
  type: OrderType;
  amount?: number;
  quoteAmount?: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  leverage?: number;
  postOnly?: boolean;
  timeInForce?: "GTC" | "IOC" | "FOK";
};

type MarketInfo = { base?: string; quote?: string; limits?: { amount?: { min?: number } } };

export const placeOrderTool: Tool<Args> = {
  name: "PlaceOrder",
  policy: { alwaysAsk: true },
  description:
    "Places an order on an exchange account (spot or futures). Types: `market`, `limit` (requires `price`), `stop` (market triggered at `stopPrice`), `stop_limit` (`price` + `stopPrice`), `take_profit` (market triggered at `stopPrice`). " +
    "Quantity: `amount` in base asset (0.05 BTC) OR `quoteAmount` in quote currency (200 USDT, converted at the current price). On futures: `reduceOnly` to only ever reduce a position, `leverage` to set the leverage before the order. " +
    "The user must authorize each order: wait for the result before placing another.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["market", "limit", "stop", "stop_limit", "take_profit"] },
      amount: { type: "number", minimum: 0, description: "Quantity in base asset." },
      quoteAmount: { type: "number", minimum: 0, description: "Amount in quote currency, instead of `amount`." },
      price: { type: "number", minimum: 0, description: "Limit price (limit, stop_limit)." },
      stopPrice: { type: "number", minimum: 0, description: "Trigger price (stop, stop_limit, take_profit)." },
      reduceOnly: { type: "boolean", description: "Futures: the order can only reduce the position." },
      leverage: { type: "integer", minimum: 1, maximum: 125, description: "Futures: leverage to apply before the order." },
      postOnly: { type: "boolean", description: "Limit: rejected if it would execute immediately." },
      timeInForce: { type: "string", enum: ["GTC", "IOC", "FOK"] },
      account: ACCOUNT_PROP,
      market: MARKET_PROP,
    },
    required: ["symbol", "side", "type"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx);
    if ("error" in r) return fail(r.error);
    const readOnly = futuresActionError(r.account, r.market);
    if (readOnly) return fail(readOnly);
    const s = symbolOn(r.ex, args.symbol, r.market);
    if ("error" in s) return fail(s.error);
    const symbol = s.symbol;
    const info = (r.ex.markets?.[symbol] ?? {}) as MarketInfo;

    if ((args.amount === undefined) === (args.quoteAmount === undefined)) {
      return fail(`Give \`amount\` (in ${info.base ?? "base asset"}) or \`quoteAmount\` (in ${info.quote ?? "quote currency"}), not both.`);
    }
    if ((args.type === "limit" || args.type === "stop_limit") && args.price === undefined) return fail(`A \`${args.type}\` order requires \`price\`.`);
    if ((args.type === "stop" || args.type === "stop_limit" || args.type === "take_profit") && args.stopPrice === undefined) return fail(`A \`${args.type}\` order requires \`stopPrice\`.`);

    return attempt(async () => {
      if (r.market === "futures") {
        const hedge = await hedgeModeError(r.ex, symbol);
        if (hedge) return fail(hedge);
      }
      const sized = await sizeOf(r, symbol, info, args);
      if ("error" in sized) return fail(sized.error);
      const amount = sized.amount;

      if (r.market === "futures" && args.leverage !== undefined) await r.ex.setLeverage(args.leverage, symbol);

      const params: Record<string, unknown> = {};
      if (args.reduceOnly) params.reduceOnly = true;
      if (args.postOnly) params.postOnly = true;
      if (args.timeInForce) params.timeInForce = args.timeInForce;
      const price = args.price !== undefined ? Number(r.ex.priceToPrecision(symbol, args.price)) : undefined;
      const stop = args.stopPrice !== undefined ? Number(r.ex.priceToPrecision(symbol, args.stopPrice)) : undefined;
      let type: "market" | "limit" = "market";
      let limit: number | undefined;
      if (args.type === "limit") {
        type = "limit";
        limit = price;
      } else if (args.type === "stop" || args.type === "stop_limit") {
        if (args.type === "stop_limit") {
          type = "limit";
          limit = price;
        }
        params.triggerPrice = stop;
        const direction = await triggerDirection(r.ex, symbol, r.market, stop as number);
        if (direction) params.triggerDirection = direction;
      } else if (args.type === "take_profit") params.takeProfitPrice = stop;

      const o = (await r.ex.createOrder(symbol, type, args.side, amount, limit, params)) as Order;
      const parts = [`Order #${o.id} ${o.status ?? "sent"}`, `${args.side.toUpperCase()} ${n8(o.amount ?? amount)} ${symbol} ${args.type}${limit ? ` @ ${n8(limit)}` : ""}`];
      if (o.average) parts.push(`average ${n8(o.average)}`);
      if (o.filled) parts.push(`filled ${n8(o.filled)}`);
      return ok(parts.join(" · "));
    });
  },
};

/** The quantity in base, rounded, above the minimum. */
async function sizeOf(r: Resolved, symbol: string, info: MarketInfo, args: Args): Promise<{ amount: number } | { error: string }> {
  let raw = args.amount;
  if (raw === undefined) {
    const t = (await r.ex.fetchTicker(symbol)) as { last?: number };
    if (!t.last) return { error: `No current price for ${symbol}: give \`amount\`.` };
    raw = (args.quoteAmount ?? 0) / t.last;
  }
  const amount = Number(r.ex.amountToPrecision(symbol, raw));
  const min = info.limits?.amount?.min;
  if (!(amount > 0) || (min !== undefined && amount < min)) {
    return { error: `Quantity ${n8(amount)} below the market minimum (${n8(min)} ${info.base ?? ""}).`.replace(/\s+\)/, ")") };
  }
  return { amount };
}
