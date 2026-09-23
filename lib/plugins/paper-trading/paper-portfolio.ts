import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { tableCard } from "../shared/cards";
import type { Desk } from "./desk";
import { SIMULATED, num, portfolioLines, signed, usdt } from "./present";

/* PaperPortfolio: the simulated portfolio at the current prices — cash,
   holdings, futures positions, open orders, realized and unrealized
   result. Reading it also fills the limits the market reached. */

export function paperPortfolioTool(desk: Desk): Tool<Record<string, never>> {
  return {
    name: "PaperPortfolio",
    policy: { readOnly: true, subagent: true },
    description: "Shows the SIMULATED paper portfolio: equity against the starting capital, cash, spot holdings with their average price, futures positions with PnL and liquidation price, open orders, last fills. Paper money only.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      const look = await desk.look({ bytnodeKey: ctx.bytnodeKey, accounts: ctx.exchangeAccounts, signal: ctx.signal });
      const v = look.valuation;
      const rows = [
        ...v.holdings.map((h) => [h.asset, "spot", num(h.amount), h.value !== undefined ? usdt(h.value) : "no price"]),
        ...v.positions.map((p) => [p.symbol, `${p.side} ×${p.leverage}`, num(p.amount), p.unrealized !== undefined ? `PnL ${signed(p.unrealized)}` : "no price"]),
      ];
      return {
        ...ok([...portfolioLines(look.book, v, look.at), ...look.priceErrors].join("\n")),
        card: tableCard(v.equity !== undefined ? `Paper portfolio · ${usdt(v.equity)}` : "Paper portfolio", ["Asset", "Kind", "Amount", "Value"], [["Cash", "", "", usdt(v.cash)], ...rows], { badge: "PAPER", note: SIMULATED }),
      };
    },
  };
}
