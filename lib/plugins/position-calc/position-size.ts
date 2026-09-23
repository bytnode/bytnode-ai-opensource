import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { factsCard } from "../shared/cards";
import { money, n8, pct } from "../shared/format";
import { positionSize, type Side } from "./calc";

/* PositionSize: how much to buy so that a stop costs exactly the risk
   accepted, fees included. */

type Args = { capital: number; riskPercent?: number; riskAmount?: number; entry: number; stop: number; side: Side; feeRate?: number; quote?: string };

export function positionSizeTool(defaultFee: () => number): Tool<Args> {
  return {
    name: "PositionSize",
    policy: { readOnly: true, subagent: true },
    description:
      "Computes the position size for a trade from the capital, the risk accepted (`riskPercent` of the capital OR `riskAmount` in quote currency), the entry and the stop: the size in base asset and in quote, the implied leverage, the fees. " +
      "Run it BEFORE proposing any PlaceOrder, and use its size. Refuses a stop on the wrong side of the entry or a risk larger than the capital.",
    parameters: {
      type: "object",
      properties: {
        capital: { type: "number", minimum: 0, description: "The account equity, in quote currency." },
        riskPercent: { type: "number", minimum: 0, maximum: 100, description: "The risk, in % of the capital (1 = 1 %)." },
        riskAmount: { type: "number", minimum: 0, description: "The risk, in quote currency, instead of riskPercent." },
        entry: { type: "number", minimum: 0, description: "Entry price." },
        stop: { type: "number", minimum: 0, description: "Stop price." },
        side: { type: "string", enum: ["long", "short"] },
        feeRate: { type: "number", minimum: 0, maximum: 0.01, description: "Fee per side as a fraction (0.0006 = 0.06 %). Default: the user's setting." },
        quote: { type: "string", description: "The quote currency, for display (default USDT)." },
      },
      required: ["capital", "entry", "stop", "side"],
      additionalProperties: false,
    },
    async execute(args) {
      const feeRate = args.feeRate ?? defaultFee();
      const r = positionSize({ ...args, feeRate });
      if ("error" in r) return fail(r.error);
      const q = args.quote ?? "USDT";
      const rows: Array<[string, string]> = [
        ["Size", `${n8(r.size)} (base asset)`],
        ["Notional", money(r.notional, q)],
        ["Implied leverage", `×${n8(Number(r.leverage.toFixed(2)))}`],
        ["Risk at the stop", money(r.riskAmount, q)],
        ["Stop distance", pct(r.stopDistancePct)],
        ["Fees (entry + exit)", money(r.fees, q)],
      ];
      const assumption = `Fees ${pct(feeRate * 100, 3)} per side; no slippage.`;
      return {
        ...ok([`Position size — ${args.side} ${n8(args.entry)} → stop ${n8(args.stop)}`, ...rows.map(([k, v]) => `${k}: ${v}`), assumption].join("\n")),
        card: factsCard(`Position size · ${args.side}`, rows, { note: assumption }),
      };
    },
  };
}
