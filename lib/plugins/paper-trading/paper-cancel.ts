import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { Shelf } from "./desk";
import { orderLine } from "./present";

/* PaperCancel: cancels a simulated order still open (`all`: every one),
   which frees what it held. */

type Args = { orderId: string; portfolio?: string };

export function paperCancelTool(shelf: Shelf): Tool<Args> {
  return {
    name: "PaperCancel",
    policy: { gated: false, subagent: false },
    description: "Cancels an open SIMULATED order of a paper portfolio (the first one unless `portfolio` names another) by its id (PaperPortfolio lists them), or `all`.",
    parameters: {
      type: "object",
      properties: { orderId: { type: "string", description: "The paper order's id, or `all`." }, portfolio: { type: "string", description: "The paper portfolio, by name (default: the first one; PaperPortfolio lists them)." }, },
      required: ["orderId"],
      additionalProperties: false,
    },
    async execute(args) {
      const picked = await shelf.pick(args.portfolio);
      if ("error" in picked) return fail(picked.error);
      const r = await picked.desk.cancel(args.orderId.trim());
      if ("error" in r) return fail(r.error);
      return ok(`PAPER order${r.cancelled.length > 1 ? "s" : ""} cancelled${picked.many ? ` in "${picked.book.name}"` : ""}: ${r.cancelled.map(orderLine).join("; ")}.`);
    },
  };
}
