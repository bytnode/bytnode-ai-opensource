import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { CURRENCIES } from "../shared/fx";
import { history, type Snapshot } from "./aggregate";
import { moneyIn } from "./money";
import { historyLines } from "./present";

/* PortfolioHistory: the total's evolution, from the daily snapshots. */

type Args = { days?: number; currency?: string };

export function portfolioHistoryTool(snapshots: () => Promise<Snapshot[]>, defaultCurrency: () => string): Tool<Args> {
  return {
    name: "PortfolioHistory",
    policy: { readOnly: true, subagent: true },
    description:
      "The evolution of the portfolio's total value over a period, from the daily snapshots the app takes while it is open (live accounts only): first and last value, change, low and high, one line per day.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 2, maximum: 3650, description: "The period, in days. Default 30." },
        currency: { type: "string", enum: [...CURRENCIES], description: "Default: the user's setting." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const days = args.days ?? 30;
      const [points, money] = await Promise.all([snapshots().then((all) => history(all, days, new Date())), moneyIn(args.currency, defaultCurrency())]);
      return ok(historyLines(points, money, days).join("\n"));
    },
  };
}
