import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import { n8, pct } from "../shared/format";
import { riskReward, type Side } from "./calc";

/* RiskReward: what each target pays for what the stop risks, and the win
   rate below which the trade loses money over time. */

type Args = { side: Side; entry: number; stop: number; targets: number[]; feeRate?: number };

export function riskRewardTool(defaultFee: () => number): Tool<Args> {
  return {
    name: "RiskReward",
    policy: { readOnly: true, subagent: true },
    description:
      "For a trade idea — entry, stop, one or more targets — the reward/risk ratio of each target, fees included, and the minimum win rate for it to pay over time. Use it to judge a setup before proposing it.",
    parameters: {
      type: "object",
      properties: {
        side: { type: "string", enum: ["long", "short"] },
        entry: { type: "number", minimum: 0 },
        stop: { type: "number", minimum: 0 },
        targets: { type: "array", items: { type: "number", minimum: 0 }, description: "One to ten take-profit prices." },
        feeRate: { type: "number", minimum: 0, maximum: 0.01, description: "Fee per side as a fraction. Default: the user's setting." },
      },
      required: ["side", "entry", "stop", "targets"],
      additionalProperties: false,
    },
    async execute(args) {
      const feeRate = args.feeRate ?? defaultFee();
      const r = riskReward({ ...args, targets: args.targets.slice(0, 10), feeRate });
      if ("error" in r) return fail(r.error);
      const rows = r.rows.map((x) => [n8(x.target), `${x.ratio.toFixed(2)} R`, pct(x.breakevenWinRate * 100, 1)]);
      const note = `Risk per unit ${n8(Number(r.risk.toPrecision(8)))} (fees ${pct(feeRate * 100, 3)} per side). Below the break-even win rate, the setup loses money over time.`;
      return {
        ...ok([`Risk/reward — ${args.side} ${n8(args.entry)}, stop ${n8(args.stop)}`, ...rows.map(([t, rr, w]) => `Target ${t}: ${rr}, break-even win rate ${w}`), note].join("\n")),
        card: tableCard(`Risk/reward · ${args.side}`, ["Target", "Ratio", "Break-even win rate"], rows, { note }),
      };
    },
  };
}
