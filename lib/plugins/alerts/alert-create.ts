import { randomUUID } from "node:crypto";
import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { pickAccount } from "@/lib/tools/exchange/accounts";
import { factsCard } from "../shared/cards";
import { WATCHLIST, newAlert, type Alert } from "./alerts";
import { EXAMPLES, METRICS_HELP, describeCondition, onPosition, parseCondition } from "./conditions";

/* AlertCreate: an alert on an asset or on the whole watchlist. Free to use
   — it only notifies — but kept from sub-agents: what pings the user is
   theirs to decide. */

type Args = { symbol: string; condition: string; once?: boolean; note?: string; account?: string };

export function alertCreateTool(add: (alert: Alert) => Promise<void>, hasCalendar: () => boolean, hasWatchlist: () => boolean = () => true): Tool<Args> {
  return {
    name: "AlertCreate",
    policy: { gated: false, subagent: false },
    description:
      `Creates an alert that notifies the user when a condition becomes true, checked every minute while the app is open. Conditions: ${EXAMPLES}. ${METRICS_HELP} ` +
      "`symbol`: a pair (BTC/USDT, \"btc\" is understood) or `watchlist` for every asset of the user's watchlist. `once` (default true): done after it fires; false: fires at every new crossing. Position conditions need the futures `account`.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "A pair, or `watchlist`." },
        condition: { type: "string", description: `One of: ${EXAMPLES}.` },
        once: { type: "boolean", description: "Fire once, then stop (default true)." },
        note: { type: "string", description: "Why the user wants it, shown with the notification." },
        account: { type: "string", description: "Position conditions: the exchange account, by its label." },
      },
      required: ["symbol", "condition"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const condition = parseCondition(args.condition);
      if ("error" in condition) return fail(condition.error);
      if (condition.kind === "event" && !hasCalendar()) return fail("Event alerts need the market calendar: it is off (Settings → Plugins).");
      let accountId: string | undefined;
      if (onPosition(condition)) {
        const picked = pickAccount(ctx.exchangeAccounts ?? [], args.account);
        if ("error" in picked) return fail(picked.error);
        accountId = picked.account.id;
      }
      const made = newAlert({ target: args.symbol, condition: args.condition, once: args.once, note: args.note, accountId }, randomUUID().slice(0, 8), new Date());
      if ("error" in made) return fail(made.error);
      if (made.alert.target === WATCHLIST && !hasWatchlist()) return fail("Watchlist alerts need the watchlist: it is off (Settings → Plugins). Set the alert on a pair instead, or ask the user to switch the watchlist on.");
      await add(made.alert);
      const a = made.alert;
      const target = a.target === WATCHLIST ? "every asset of the watchlist" : a.target;
      const label = describeCondition(condition);
      return {
        ...ok(`Alert [${a.id}] set: ${target}, ${a.condition} (${label}), ${a.once ? "once" : "at every crossing"}. It fires in the notification center, checked every minute while the app is open; if the condition already holds, it fires at the next check.`),
        card: factsCard("Alert", [
          ["On", target],
          ["When", label],
          ["Fires", a.once ? "once" : "at every crossing"],
          ...(a.note ? ([["Note", a.note]] as Array<[string, string]>) : []),
        ]),
      };
    },
  };
}
