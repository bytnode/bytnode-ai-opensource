import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { Desk } from "./desk";
import { orderLine } from "./present";

/* PaperCancel: cancels a simulated order still open (`all`: every one),
   which frees what it held. */

type Args = { orderId: string };

export function paperCancelTool(desk: Desk): Tool<Args> {
  return {
    name: "PaperCancel",
    policy: { gated: false, subagent: false },
    description: "Cancels an open SIMULATED order of the paper portfolio by its id (PaperPortfolio lists them), or `all`.",
    parameters: {
      type: "object",
      properties: { orderId: { type: "string", description: "The paper order's id, or `all`." } },
      required: ["orderId"],
      additionalProperties: false,
    },
    async execute(args) {
      const r = await desk.cancel(args.orderId.trim());
      if ("error" in r) return fail(r.error);
      return ok(`PAPER order${r.cancelled.length > 1 ? "s" : ""} cancelled: ${r.cancelled.map(orderLine).join("; ")}.`);
    },
  };
}
