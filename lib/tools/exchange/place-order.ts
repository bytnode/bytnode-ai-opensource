import type { Order } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, SYMBOL_PROP, attempt, hedgeModeError, resolve, symbolOn, type BaseArgs, type Resolved } from "./common";
import { n8 } from "./format";

/* ---------------------------------------------------------------------------
   PlaceOrder : un ordre, spot ou futures.

   ⚠️ DEMANDE TOUJOURS L'ACCORD DE L'UTILISATEUR (`ALWAYS_ASK`). Avant de
   toucher l'exchange : une seule quantite (base ou quote), le prix qu'exige
   le type, l'arrondi a la precision du marche, le minimum, et pas de hedge
   mode. Ce qui est refuse ici l'est sans un appel a l'exchange.
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
  description:
    "Passe un ordre sur un compte exchange (spot ou futures). Types : `market`, `limit` (exige `price`), `stop` (market déclenché à `stopPrice`), `stop_limit` (`price` + `stopPrice`), `take_profit` (market déclenché à `stopPrice`). " +
    "Quantité : `amount` en actif de base (0.05 BTC) OU `quoteAmount` en devise de cotation (200 USDT, converti au prix courant). En futures : `reduceOnly` pour ne faire que réduire une position, `leverage` pour régler le levier avant l'ordre. " +
    "L'utilisateur doit autoriser chaque ordre : attends le résultat avant d'en passer un autre.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["market", "limit", "stop", "stop_limit", "take_profit"] },
      amount: { type: "number", minimum: 0, description: "Quantité en actif de base." },
      quoteAmount: { type: "number", minimum: 0, description: "Montant en devise de cotation, à la place de `amount`." },
      price: { type: "number", minimum: 0, description: "Prix limite (limit, stop_limit)." },
      stopPrice: { type: "number", minimum: 0, description: "Prix de déclenchement (stop, stop_limit, take_profit)." },
      reduceOnly: { type: "boolean", description: "Futures : l'ordre ne peut que réduire la position." },
      leverage: { type: "integer", minimum: 1, maximum: 125, description: "Futures : levier à appliquer avant l'ordre." },
      postOnly: { type: "boolean", description: "Limit : rejeté s'il s'exécuterait tout de suite." },
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
    const s = symbolOn(r.ex, args.symbol, r.market);
    if ("error" in s) return fail(s.error);
    const symbol = s.symbol;
    const info = (r.ex.markets?.[symbol] ?? {}) as MarketInfo;

    if ((args.amount === undefined) === (args.quoteAmount === undefined)) {
      return fail(`Donne \`amount\` (en ${info.base ?? "actif de base"}) ou \`quoteAmount\` (en ${info.quote ?? "devise de cotation"}), pas les deux.`);
    }
    if ((args.type === "limit" || args.type === "stop_limit") && args.price === undefined) return fail(`Un ordre \`${args.type}\` exige \`price\`.`);
    if ((args.type === "stop" || args.type === "stop_limit" || args.type === "take_profit") && args.stopPrice === undefined) return fail(`Un ordre \`${args.type}\` exige \`stopPrice\`.`);

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
      let type: "market" | "limit" = "market";
      let limit: number | undefined;
      if (args.type === "limit") {
        type = "limit";
        limit = price;
      } else if (args.type === "stop") params.triggerPrice = args.stopPrice;
      else if (args.type === "stop_limit") {
        type = "limit";
        limit = price;
        params.triggerPrice = args.stopPrice;
      } else if (args.type === "take_profit") params.takeProfitPrice = args.stopPrice;

      const o = (await r.ex.createOrder(symbol, type, args.side, amount, limit, params)) as Order;
      const parts = [`Ordre #${o.id} ${o.status ?? "envoyé"}`, `${args.side.toUpperCase()} ${n8(o.amount ?? amount)} ${symbol} ${args.type}${limit ? ` @ ${n8(limit)}` : ""}`];
      if (o.average) parts.push(`moyen ${n8(o.average)}`);
      if (o.filled) parts.push(`rempli ${n8(o.filled)}`);
      return ok(parts.join(" · "));
    });
  },
};

/** La quantite en base, arrondie, au-dessus du minimum. */
async function sizeOf(r: Resolved, symbol: string, info: MarketInfo, args: Args): Promise<{ amount: number } | { error: string }> {
  let raw = args.amount;
  if (raw === undefined) {
    const t = (await r.ex.fetchTicker(symbol)) as { last?: number };
    if (!t.last) return { error: `Pas de prix courant pour ${symbol} : donne \`amount\`.` };
    raw = (args.quoteAmount ?? 0) / t.last;
  }
  const amount = Number(r.ex.amountToPrecision(symbol, raw));
  const min = info.limits?.amount?.min;
  if (!(amount > 0) || (min !== undefined && amount < min)) {
    return { error: `Quantité ${n8(amount)} sous le minimum du marché (${n8(min)} ${info.base ?? ""}).`.replace(/\s+\)/, ")") };
  }
  return { amount };
}
