import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { exchangeInfo } from "@/lib/tools/exchange/catalog";
import { factsCard } from "../shared/cards";
import { n8, pct, signedPct } from "../shared/format";
import { liquidation, type Side } from "./calc";

/* LiquidationPrice: where a leveraged position would be liquidated — an
   estimate, shown with its assumptions (exchanges use tiered margin). */

type Args = { side: Side; entry: number; leverage?: number; mode?: "isolated" | "cross"; size?: number; collateral?: number; maintenanceMargin?: number; exchange?: string };

/** When neither the call nor the exchange gives one. */
const DEFAULT_MMR = 0.005;

export const liquidationPriceTool: Tool<Args> = {
  name: "LiquidationPrice",
  policy: { readOnly: true, subagent: true },
  description:
    "Estimates the liquidation price of a USDT perpetual position (one-way): `isolated` from the entry and the leverage, `cross` from the size and the collateral backing it. " +
    "The maintenance margin rate is `maintenanceMargin` if given, else the first tier of the `exchange` (ccxt id), else 0.5 %. Run it before proposing a leveraged order, and say it is an estimate.",
  parameters: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["long", "short"] },
      entry: { type: "number", minimum: 0, description: "Entry price." },
      leverage: { type: "number", minimum: 1, maximum: 200, description: "Isolated: the leverage." },
      mode: { type: "string", enum: ["isolated", "cross"], description: "Default isolated." },
      size: { type: "number", minimum: 0, description: "Cross: the position size in base asset." },
      collateral: { type: "number", minimum: 0, description: "Cross: the collateral backing the position, in quote currency." },
      maintenanceMargin: { type: "number", minimum: 0, maximum: 0.5, description: "The maintenance margin rate as a fraction (0.005 = 0.5 %)." },
      exchange: { type: "string", description: "The exchange (ccxt id: binance, bybit, okx…), for its default rate." },
    },
    required: ["side", "entry"],
    additionalProperties: false,
  },
  async execute(args) {
    const info = args.exchange ? exchangeInfo(args.exchange) : undefined;
    const mmr = args.maintenanceMargin ?? info?.maintenanceMargin ?? DEFAULT_MMR;
    const mode = args.mode ?? "isolated";
    const r = liquidation({ side: args.side, entry: args.entry, mmr, mode, leverage: args.leverage, size: args.size, collateral: args.collateral });
    if ("error" in r) return fail(r.error);
    const source = args.maintenanceMargin !== undefined ? "given" : info?.maintenanceMargin !== undefined ? `${info.label}'s first tier` : "default";
    const assumption = `Estimate: ${mode} margin, maintenance margin ${pct(mmr * 100, 2)} (${source}), fees and funding left out. Large positions use higher tiers: the real price is closer.`;
    const rows: Array<[string, string]> = [
      ["Liquidation price", n8(Number(r.price.toPrecision(8)))],
      ["Distance from entry", signedPct(r.distancePct)],
      ...(mode === "isolated" ? ([["Leverage", `×${args.leverage}`]] as Array<[string, string]>) : ([["Collateral", n8(args.collateral)]] as Array<[string, string]>)),
    ];
    return {
      ...ok([`Liquidation — ${args.side} at ${n8(args.entry)}`, ...rows.map(([k, v]) => `${k}: ${v}`), assumption].join("\n")),
      card: factsCard(`Liquidation · ${args.side} ${mode}`, rows, { note: assumption }),
    };
  },
};
