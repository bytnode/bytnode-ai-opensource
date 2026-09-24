import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import type { DcaGroup } from "./groups";
import type { DcaPlan, Purchase } from "./plans";
import { planLine, purchaseLine } from "./present";

/* DcaList: the plans, their next due date, what they bought (total,
   quantity, average price) and their last purchases. Read-only. */

const LAST = 5;

export function dcaListTool(read: () => Promise<{ plans: DcaPlan[]; purchases: Purchase[]; groups: DcaGroup[] }>): Tool<Record<string, never>> {
  return {
    name: "DcaList",
    policy: { readOnly: true, subagent: true },
    description: "Lists the recurring purchases (DCA plans): asset, amount, frequency, paper or real account, next due date, total invested, quantity bought, average purchase price, and the last purchases.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      const { plans, purchases, groups } = await read();
      if (plans.length === 0) return ok("No DCA plan.");
      const accounts = ctx.exchangeAccounts ?? [];
      const blocks = plans.map((plan) => {
        const last = purchases.filter((p) => p.planId === plan.id).slice(-LAST).reverse();
        const group = groups.find((g) => g.id === plan.groupId);
        return [`${planLine(plan, purchases, accounts)}${group ? ` [group: ${group.name}]` : ""}`, ...last.map((p) => `    ${purchaseLine(p)}`)].join("\n");
      });
      return ok([`DCA plans (${plans.length}), running while the app is open:`, ...blocks].join("\n"));
    },
  };
}
