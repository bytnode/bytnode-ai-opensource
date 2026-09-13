import type { Tool } from "../types";
import { ok } from "../types";
import { ACCOUNT_PROP, MARKET_PROP, attempt, resolve, type BaseArgs } from "./common";
import { formatBalance, type BalanceRow } from "./format";

/* ExchangeBalance : les soldes d'un compte, avec une estimation en USD
   quand l'exchange cote l'actif contre USDT. Lecture seule. */

const STABLES = new Set(["USDT", "USDC", "USD", "FDUSD", "BUSD", "DAI", "TUSD", "USDE"]);

type Balances = { total?: Record<string, number>; free?: Record<string, number>; used?: Record<string, number> };

export const balanceTool: Tool<BaseArgs> = {
  name: "ExchangeBalance",
  description: "Les soldes d'un compte exchange (spot ou futures) : par actif, libre / bloqué, et une estimation en USD. Lecture seule, sans permission.",
  parameters: { type: "object", properties: { account: ACCOUNT_PROP, market: MARKET_PROP }, additionalProperties: false },
  async execute(args, ctx) {
    const r = await resolve(args, ctx);
    if ("error" in r) return { ok: false, output: r.error };
    return attempt(async () => {
      const b = (await r.ex.fetchBalance()) as Balances;
      const rows: BalanceRow[] = Object.entries(b.total ?? {})
        .filter(([, total]) => typeof total === "number" && total > 0)
        .map(([asset, total]) => ({ asset, total, free: b.free?.[asset] ?? 0, used: b.used?.[asset] ?? 0 }));
      const quoted = rows.filter((row) => !STABLES.has(row.asset) && r.ex.markets?.[`${row.asset}/USDT`]).map((row) => `${row.asset}/USDT`);
      let prices: Record<string, { last?: number }> = {};
      if (quoted.length && r.ex.has["fetchTickers"]) {
        try {
          prices = (await r.ex.fetchTickers(quoted)) as Record<string, { last?: number }>;
        } catch {
          /* pas de prix : on affiche sans estimation */
        }
      }
      for (const row of rows) {
        if (STABLES.has(row.asset)) row.usd = row.total;
        else {
          const last = prices[`${row.asset}/USDT`]?.last;
          if (typeof last === "number") row.usd = Number((row.total * last).toFixed(2));
        }
      }
      return ok(formatBalance(r.account.label, r.market, rows));
    });
  },
};
