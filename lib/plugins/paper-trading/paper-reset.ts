import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { Shelf } from "./desk";
import { usdt } from "./present";

/* PaperReset: starts the simulated portfolio over, from a capital. Gated:
   the history of the exercise is lost. */

type Args = { capital?: number; portfolio?: string };

export function paperResetTool(shelf: Shelf): Tool<Args> {
  return {
    name: "PaperReset",
    policy: { gated: true, subagent: false },
    description: "Resets a SIMULATED paper portfolio (the first one unless `portfolio` names another): every holding, position, order and fill is erased, the cash is set to `capital` (default: the capital in the plugin's settings). Only when the user asks.",
    parameters: {
      type: "object",
      properties: { capital: { type: "number", minimum: 100, maximum: 10_000_000, description: "Starting cash in USDT." }, portfolio: { type: "string", description: "The paper portfolio, by name (default: the first one; PaperPortfolio lists them)." }, },
      additionalProperties: false,
    },
    async execute(args) {
      if (args.capital !== undefined && !(args.capital >= 100)) return fail("A capital of at least 100 USDT.");
      const picked = await shelf.pick(args.portfolio);
      if ("error" in picked) return fail(picked.error);
      const book = await picked.desk.reset(args.capital);
      return ok(`Paper portfolio${picked.many ? ` "${picked.book.name}"` : ""} reset: ${usdt(book.capital)} of paper cash, nothing else.`);
    },
  };
}
