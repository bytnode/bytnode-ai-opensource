import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { DcaPlan, PlanAction } from "./plans";

/* DcaPause: pauses, resumes or deletes a DCA plan. Gated. */

type Args = { plan: string; action?: PlanAction };

export function dcaPauseTool(change: (id: string, action: PlanAction) => Promise<{ plan: DcaPlan } | { error: string }>): Tool<Args> {
  return {
    name: "DcaPause",
    policy: { gated: true, subagent: false },
    description: "Pauses a DCA plan (default), resumes it from its next due date, or deletes it. `plan`: its id (DcaList shows them).",
    parameters: {
      type: "object",
      properties: {
        plan: { type: "string", description: "The plan's id." },
        action: { type: "string", enum: ["pause", "resume", "delete"], description: "Default: pause." },
      },
      required: ["plan"],
      additionalProperties: false,
    },
    async execute(args) {
      const action = args.action ?? "pause";
      const r = await change(args.plan, action);
      if ("error" in r) return fail(r.error);
      const done = action === "delete" ? "deleted" : action === "pause" ? "paused" : `resumed, next due ${r.plan.nextDue?.slice(0, 16).replace("T", " ")} UTC`;
      return ok(`DCA plan [${r.plan.id}] (${r.plan.quoteAmount} of ${r.plan.symbol}, ${r.plan.frequency}) ${done}.`);
    },
  };
}
