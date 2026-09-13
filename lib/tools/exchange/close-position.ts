import type { Order, Position } from "ccxt";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { ACCOUNT_PROP, SYMBOL_PROP, attempt, hedgeModeError, resolve, symbolOn } from "./common";
import { n8, positionSize } from "./format";

/* ClosePosition : ferme tout ou partie d'une position futures par un ordre
   market oppose, reduceOnly. Demande TOUJOURS (`ALWAYS_ASK`). */

type Args = { account?: string; symbol: string; fraction?: number };

export const closePositionTool: Tool<Args> = {
  name: "ClosePosition",
  description: "Ferme une position futures (tout, ou une `fraction` de 0.01 à 1) par un ordre market opposé en reduceOnly. L'utilisateur doit autoriser chaque fermeture.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL_PROP,
      fraction: { type: "number", minimum: 0.01, maximum: 1, description: "Part de la position à fermer (défaut 1 = tout)." },
      account: ACCOUNT_PROP,
    },
    required: ["symbol"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const r = await resolve(args, ctx, "futures");
    if ("error" in r) return fail(r.error);
    const s = symbolOn(r.ex, args.symbol, "futures");
    if ("error" in s) return fail(s.error);
    const symbol = s.symbol;
    const fraction = args.fraction ?? 1;
    return attempt(async () => {
      const hedge = await hedgeModeError(r.ex, symbol);
      if (hedge) return fail(hedge);
      const positions = (await r.ex.fetchPositions([symbol])) as Position[];
      const p = positions.find((x) => x.symbol === symbol && (x.contracts ?? 0) > 0);
      if (!p) return fail(`Aucune position ouverte sur ${symbol}.`);
      const amount = Number(r.ex.amountToPrecision(symbol, positionSize(p) * fraction));
      if (!(amount > 0)) return fail(`La fraction ${fraction} donne une quantité nulle après arrondi.`);
      const side = p.side === "long" ? "sell" : "buy";
      const o = (await r.ex.createOrder(symbol, "market", side, amount, undefined, { reduceOnly: true })) as Order;
      return ok(`Position ${symbol} ${(p.side ?? "?").toUpperCase()} fermée à ${Math.round(fraction * 100)} % (${n8(amount)}) · ordre #${o.id} ${o.status ?? "envoyé"}`);
    });
  },
};
