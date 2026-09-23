import type { Tool } from "../types";
import { ok } from "../types";
import type { Exchange } from "ccxt";
import { exchangeInfo } from "./catalog";
import { ACCOUNT_PROP, MARKET_PROP, attempt, resolve, type BaseArgs } from "./common";
import { formatBalance, type BalanceRow } from "./format";

/* ExchangeBalance: an account's balances, with a USD estimate when the
   exchange quotes the asset against USDT. Read-only.

   ⚠️ THE FUNDING WALLET IS READ SEPARATELY. On Bybit, OKX or KuCoin, a
   deposit does not land on the trading account but in a separate wallet:
   "connected, no balance" while there are 40 USDC on the account. We read
   it too, and say where the funds are. */

const STABLES = new Set(["USDT", "USDC", "USD", "FDUSD", "BUSD", "DAI", "TUSD", "USDE"]);

export type Balances = { total?: Record<string, number>; free?: Record<string, number>; used?: Record<string, number> };

export const rowsOf = (b: Balances): BalanceRow[] =>
  Object.entries(b.total ?? {})
    .filter(([, total]) => typeof total === "number" && total > 0)
    .map(([asset, total]) => ({ asset, total, free: b.free?.[asset] ?? 0, used: b.used?.[asset] ?? 0 }));

/** This exchange's Funding wallet, if it has one distinct from trading;
    `undefined` otherwise, or if reading it fails (the key may lack the
    "transfer" permission Bybit requires to read it). */
export async function fundingRows(ex: Exchange, exchange: string): Promise<BalanceRow[] | undefined> {
  const wallet = exchangeInfo(exchange)?.funding;
  if (!wallet) return undefined;
  try {
    return rowsOf((await ex.fetchBalance({ type: wallet })) as Balances);
  } catch {
    return undefined;
  }
}

export const balanceTool: Tool<BaseArgs> = {
  name: "ExchangeBalance",
  policy: { readOnly: true, subagent: true },
  description: "The balances of an exchange account (spot or futures): per asset, free / locked, and a USD estimate. Read-only, no permission needed.",
  parameters: { type: "object", properties: { account: ACCOUNT_PROP, market: MARKET_PROP }, additionalProperties: false },
  async execute(args, ctx) {
    const r = await resolve(args, ctx);
    if ("error" in r) return { ok: false, output: r.error };
    return attempt(async () => {
      const rows = rowsOf((await r.ex.fetchBalance()) as Balances);
      const funding = r.market === "spot" ? await fundingRows(r.ex, r.account.exchange) : undefined;
      const all = [...rows, ...(funding ?? [])];
      const quoted = [...new Set(all.filter((row) => !STABLES.has(row.asset) && r.ex.markets?.[`${row.asset}/USDT`]).map((row) => `${row.asset}/USDT`))];
      let prices: Record<string, { last?: number }> = {};
      if (quoted.length && r.ex.has["fetchTickers"]) {
        try {
          prices = (await r.ex.fetchTickers(quoted)) as Record<string, { last?: number }>;
        } catch {
          /* no prices: shown without an estimate */
        }
      }
      for (const row of all) {
        if (STABLES.has(row.asset)) row.usd = row.total;
        else {
          const last = prices[`${row.asset}/USDT`]?.last;
          if (typeof last === "number") row.usd = Number((row.total * last).toFixed(2));
        }
      }
      return ok(formatBalance(r.account.label, r.market, rows, funding));
    });
  },
};
