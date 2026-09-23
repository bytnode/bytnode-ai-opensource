import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { CURRENCIES } from "../shared/fx";
import { factsCard } from "../shared/cards";
import { summarize } from "./aggregate";
import { priceBook, readAccounts } from "./collect";
import { moneyIn } from "./money";
import { summaryLines } from "./present";

/* PortfolioSummary: every account the agent may read, one figure. */

type Args = { currency?: string };

export function portfolioSummaryTool(defaultCurrency: () => string): Tool<Args> {
  return {
    name: "PortfolioSummary",
    policy: { readOnly: true, subagent: true },
    description:
      "The consolidated portfolio across the exchange accounts this agent may read: balances of every wallet (spot, futures, funding) valued in the reference currency, split by asset and by account, open positions and their unrealized PnL. Testnet accounts are listed apart and not counted; unpriced assets are listed, not valued at zero. Use it for \"how much do I have\", \"my portfolio\", \"my exposure\".",
    parameters: {
      type: "object",
      properties: { currency: { type: "string", enum: [...CURRENCIES], description: "Default: the user's setting." } },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const accounts = ctx.exchangeAccounts ?? [];
      if (accounts.length === 0) return fail("No exchange account is attached to this agent.");
      const reads = await readAccounts(accounts);
      const [book, money] = await Promise.all([priceBook(reads, { bytnodeKey: ctx.bytnodeKey, accounts, signal: ctx.signal }), moneyIn(args.currency, defaultCurrency())]);
      const s = summarize(reads, book);
      const at = new Date();
      const value = (usd: number) => `${(usd * money.perUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${money.currency}`;
      return {
        ...ok(summaryLines(s, money, at).join("\n")),
        card: factsCard(
          "Portfolio",
          [
            ["Total (live)", value(s.totalUsd)],
            ["Largest asset", s.assets[0] ? `${s.assets[0].asset} ${(s.assets[0].share * 100).toFixed(1)} %` : "—"],
            ["Accounts", `${s.accounts.length}${s.accounts.some((a) => a.error) ? " (one unreadable)" : ""}`],
            ["Open positions", s.positions.length ? `${s.positions.length}, PnL ${value(s.unrealizedPnl)}` : "none"],
            ...(s.testnetUsd > 0 ? ([["Testnet (not counted)", value(s.testnetUsd)]] as Array<[string, string]>) : []),
          ],
          { note: [money.rateNote, s.unpriced.length ? `${s.unpriced.length} unpriced asset(s) not counted.` : ""].filter(Boolean).join(" ") || undefined },
        ),
      };
    },
  };
}
