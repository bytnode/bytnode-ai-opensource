import { randomUUID } from "node:crypto";
import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { pickAccount } from "@/lib/tools/exchange/accounts";
import { factsCard } from "../shared/cards";
import type { DcaGroup } from "./groups";
import { newPlan, type DcaPlan } from "./plans";
import { badgeOf } from "./present";

/* DcaCreate: a recurring purchase. Gated — it commits future purchases —
   and kept from sub-agents. A real plan never buys by itself: each due
   date is a confirmation the user answers. */

type Args = { symbol: string; quoteAmount: number; frequency: string; destination: "paper" | "exchange"; account?: string; start?: string; end?: string; note?: string; group?: string };

export function dcaCreateTool(add: (plan: DcaPlan) => Promise<void>, paperCash: string, groupFor: (name: string) => Promise<DcaGroup | { error: string }>, paperOn: () => boolean = () => true): Tool<Args> {
  return {
    name: "DcaCreate",
    policy: { gated: true, subagent: false },
    description:
      "Creates a recurring purchase (DCA): `quoteAmount` of the pair's quote currency spent on `symbol` at each due date (`every monday at 09:00`, `daily at 08:00`, `every 7 days`; at most every hour). " +
      `\`destination: paper\` buys in the simulated paper portfolio (pairs in ${paperCash}), automatically. \`destination: exchange\` buys on the \`account\` for real — each purchase is PROPOSED to the user, who confirms it; nothing is bought without their click. Optional \`start\` and \`end\` dates; optional \`group\`, a group's name (made if new; default: the first group) — every DCA belongs to one.`,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "The pair to buy: BTC/USDT." },
        quoteAmount: { type: "number", minimum: 0, description: "Amount spent at each purchase, in the quote currency." },
        frequency: { type: "string", description: "`every monday at 09:00`, `daily at 08:00`, `every 7 days`…" },
        destination: { type: "string", enum: ["paper", "exchange"] },
        account: { type: "string", description: "`exchange`: the account, by its label." },
        start: { type: "string", description: "First date, ISO (default: now)." },
        end: { type: "string", description: "Last date, ISO (optional)." },
        note: { type: "string" },
        group: { type: "string", description: "A group to list the plan under, by name (made if new) — \"Long term\"." },
      },
      required: ["symbol", "quoteAmount", "frequency", "destination"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const accounts = ctx.exchangeAccounts ?? [];
      let accountId: string | undefined;
      if (args.destination === "exchange") {
        const picked = pickAccount(accounts, args.account);
        if ("error" in picked) return fail(picked.error);
        accountId = picked.account.id;
      }
      /* Every DCA in a group: the one named (made if new), else the first. */
      const g = await groupFor(args.group ?? "");
      if ("error" in g) return fail(g.error);
      const groupId = g.id;
      const plan = newPlan({ ...args, accountId, groupId, startAt: args.start, endAt: args.end }, randomUUID().slice(0, 8), new Date());
      if ("error" in plan) return fail(plan.error);
      if (plan.destination === "paper" && plan.symbol.split("/")[1] !== paperCash) return fail(`The paper portfolio trades against ${paperCash}: use ${plan.symbol.split("/")[0]}/${paperCash}.`);
      if (plan.destination === "paper" && !paperOn()) return fail("Paper trading is off (Settings → Plugins): a paper plan cannot buy. Ask the user to switch it on, or use `destination: exchange`.");
      await add(plan);
      const badge = badgeOf(plan, accounts);
      const quote = plan.symbol.split("/")[1];
      const how = plan.destination === "paper" ? "Simulated purchases in the paper portfolio, automatic." : `Real purchases on ${accounts.find((a) => a.id === accountId)?.label} (${badge}): at each due date the user gets a confirmation to approve — nothing is bought without it.`;
      return {
        ...ok(`DCA plan [${plan.id}]: ${plan.quoteAmount} ${quote} of ${plan.symbol}, ${plan.frequency}${plan.nextDue ? `, first due ${plan.nextDue.slice(0, 16).replace("T", " ")} UTC` : ""}. ${how} It runs while the app is open.`),
        card: factsCard(
          "Recurring purchase",
          [
            ["Buy", `${plan.quoteAmount} ${quote} of ${plan.symbol}`],
            ["When", plan.frequency],
            ["First", plan.nextDue ? `${plan.nextDue.slice(0, 16).replace("T", " ")} UTC` : "—"],
            ["How", plan.destination === "paper" ? "automatic, simulated" : "proposed, confirmed by you each time"],
          ],
          { badge },
        ),
      };
    },
  };
}
