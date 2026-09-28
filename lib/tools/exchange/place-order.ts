import type { Order } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import {
  ACCOUNT_PROP,
  MARKET_PROP,
  SYMBOL_PROP,
  attempt,
  contractSizeOf,
  futuresActionError,
  hedgeModeError,
  orderClientId,
  resolve,
  sendOnce,
  symbolOn,
  triggerDirection,
  unitsText,
  type BaseArgs,
  type Resolved,
} from "./common";
import { n8 } from "./format";

/* ---------------------------------------------------------------------------
   PlaceOrder: one order, spot or futures.

   ⚠️ ALWAYS ASKS THE USER'S CONSENT (`ALWAYS_ASK`). Before touching the
   exchange: a single quantity (base or quote), the price the type
   requires, rounding to the market's precision, the minimum, and no hedge
   mode. What is refused here is refused without a call to the exchange.
   ⚠️ The order is sent ONCE (`sendOnce`), with a client id: a lost answer
   is reported as an unknown outcome, never re-sent.
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

type MarketInfo = { base?: string; quote?: string; contractSize?: number; limits?: { amount?: { min?: number } } };

export const placeOrderTool: Tool<Args> = {
  name: "PlaceOrder",
  policy: { alwaysAsk: true },
  description:
    "Places an order on an exchange account (spot or futures). Types: `market`, `limit` (requires `price`), `stop` (market triggered at `stopPrice`), `stop_limit` (`price` + `stopPrice`), `take_profit` (market triggered at `stopPrice`). " +
    "Quantity: `amount` in base asset (0.05 BTC) OR `quoteAmount` in quote currency (200 USDT, converted at the limit price for `limit`/`stop_limit`, at `stopPrice` for `stop`/`take_profit`, at the last price for `market`); on a contract market (OKX, Gate, KuCoin, HTX futures) the tool converts to contracts itself. On futures: `reduceOnly` to only ever reduce a position, `leverage` to set the leverage before the order. " +
    "The user must authorize each order: wait for the result before placing another. If the result says the outcome is UNKNOWN, check ExchangeOrders / ExchangePositions before anything else — never re-send blindly.",
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

    /* Everything before `sendOnce` is a read (or the idempotent leverage):
       `attempt` may replay it on a transient error. The order itself is
       sent once — see `sendOnce`. */
    return attempt(async () => {
      if (r.market === "futures") {
        const hedge = await hedgeModeError(r.ex, symbol);
        if (hedge) return fail(hedge);
      }
      const price = args.price !== undefined ? Number(r.ex.priceToPrecision(symbol, args.price)) : undefined;
      const stop = args.stopPrice !== undefined ? Number(r.ex.priceToPrecision(symbol, args.stopPrice)) : undefined;
      /* `quoteAmount` is converted at the price the order will execute at:
         the limit price for limit / stop_limit, the trigger for a
         market-on-trigger order, the last price only for a market order. */
      const at = args.type === "limit" || args.type === "stop_limit" ? price : args.type === "market" ? undefined : stop;
      const sized = await sizeOf(r, symbol, info, args, at);
      if ("error" in sized) return fail(sized.error);
      const amount = sized.amount;
      const cs = sized.contractSize;

      if (r.market === "futures" && args.leverage !== undefined) await r.ex.setLeverage(args.leverage, symbol);

      const params: Record<string, unknown> = {};
      if (args.reduceOnly) params.reduceOnly = true;
      if (args.postOnly) params.postOnly = true;
      if (args.timeInForce) params.timeInForce = args.timeInForce;
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
      const clientOrderId = orderClientId(r.ex.id, r.market);
      if (clientOrderId) params.clientOrderId = clientOrderId;

      /* In the exchange's unit: contracts on a contract market. */
      const qty = (n: number) => (cs === 1 ? n8(n) : unitsText(n, cs, info.base));
      const what = `${args.side.toUpperCase()} ${qty(amount)} ${symbol} ${args.type}${limit ? ` @ ${n8(limit)}` : ""}`;
      const o = await sendOnce(
        () => r.ex.createOrder(symbol, type, args.side, amount, limit, params) as Promise<Order>,
        (detail) =>
          `Outcome UNKNOWN: the order (${what}${clientOrderId ? `, client id ${clientOrderId}` : ""}) was sent, but the exchange's answer was lost — ${detail} ` +
          `It may have been placed. Do NOT place it again: first check ExchangeOrders on ${symbol} (status "open", then "closed")${clientOrderId ? ` for client id ${clientOrderId}` : " for this side, size and time"}, and ${r.market === "futures" ? "ExchangePositions" : "ExchangeBalance"}.`,
      );
      const parts = [`Order #${o.id} ${o.status ?? "sent"}`, `${args.side.toUpperCase()} ${qty(o.amount ?? amount)} ${symbol} ${args.type}${limit ? ` @ ${n8(limit)}` : ""}`];
      if (o.average) parts.push(`average ${n8(o.average)}`);
      if (o.filled) parts.push(`filled ${qty(o.filled)}`);
      return ok(parts.join(" · "));
    });
  },
};

/** The quantity in the exchange's unit — base asset, or CONTRACTS on a
    contract market (ccxt counts `amount`, precision and minimum there in
    contracts: OKX BTC swap = 0.01 BTC per contract) —, rounded, above the
    minimum. `at`: the price a `quoteAmount` converts at (the last price
    when absent). */
async function sizeOf(r: Resolved, symbol: string, info: MarketInfo, args: Args, at: number | undefined): Promise<{ amount: number; contractSize: number } | { error: string }> {
  let base = args.amount;
  if (base === undefined) {
    let price = at;
    if (price === undefined) {
      const t = (await r.ex.fetchTicker(symbol)) as { last?: number };
      price = t.last;
    }
    if (!price) return { error: `No current price for ${symbol}: give \`amount\`.` };
    base = (args.quoteAmount ?? 0) / price;
  }
  const cs = contractSizeOf(info);
  const amount = Number(r.ex.amountToPrecision(symbol, base / cs));
  const min = info.limits?.amount?.min;
  if (!(amount > 0) || (min !== undefined && amount < min)) {
    if (cs !== 1) {
      const asset = info.base ?? "base";
      return { error: `Quantity ${n8(base)} ${asset} = ${n8(base / cs)} contracts (1 contract = ${n8(cs)} ${asset}): below the market minimum (${n8(min ?? 0)} contracts = ${n8((min ?? 0) * cs)} ${asset}).` };
    }
    return { error: `Quantity ${n8(amount)} below the market minimum (${n8(min)} ${info.base ?? ""}).`.replace(/\s+\)/, ")") };
  }
  return { amount, contractSize: cs };
}
