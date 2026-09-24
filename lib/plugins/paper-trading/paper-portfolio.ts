import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import type { Shelf } from "./desk";
import { SIMULATED, num, portfolioLines, signed, usdt } from "./present";

/* PaperPortfolio: a simulated portfolio at the current prices — cash,
   holdings, futures positions, open orders, realized and unrealized
   result — and the names of the others. Reading it also fills the limits
   the market reached. */

export function paperPortfolioTool(shelf: Shelf): Tool<{ portfolio?: string }> {
  return {
    name: "PaperPortfolio",
    policy: { readOnly: true, subagent: true },
    description:
      "Shows a SIMULATED paper portfolio (the first one unless `portfolio` names another; the answer lists the others): equity against the starting capital, cash, spot holdings with their average price, futures positions with PnL and liquidation price, open orders, last fills. Paper money only.",
    parameters: {
      type: "object",
      properties: { portfolio: { type: "string", description: "The paper portfolio, by name (default: the first one)." } },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const picked = await shelf.pick(args.portfolio);
      if ("error" in picked) return fail(picked.error);
      const others = (await shelf.list()).filter((b) => b.id !== picked.book.id).map((b) => b.name);
      const look = await picked.desk.look({ bytnodeKey: ctx.bytnodeKey, accounts: ctx.exchangeAccounts, signal: ctx.signal });
      const v = look.valuation;
      const rows = [
        ...v.holdings.map((h) => [h.asset, "spot", num(h.amount), h.value !== undefined ? usdt(h.value) : "no price"]),
        ...v.positions.map((p) => [p.symbol, `${p.side} ×${p.leverage}`, num(p.amount), p.unrealized !== undefined ? `PnL ${signed(p.unrealized)}` : "no price"]),
      ];
      const head = others.length ? [`Paper portfolio "${picked.book.name}". The other paper portfolios: ${others.join(", ")}.`] : [];
      const title = picked.many ? picked.book.name : "Paper portfolio";
      return {
        ...ok([...head, ...portfolioLines(look.book, v, look.at), ...look.priceErrors].join("\n")),
        card: tableCard(v.equity !== undefined ? `${title} · ${usdt(v.equity)}` : title, ["Asset", "Kind", "Amount", "Value"], [["Cash", "", "", usdt(v.cash)], ...rows], { badge: "PAPER", note: SIMULATED }),
      };
    },
  };
}
