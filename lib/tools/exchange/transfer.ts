import type { Tool } from "../types";
import { fail, ok } from "../types";
import { exchangeInfo } from "./catalog";
import { ACCOUNT_PROP, attempt, resolve, sendOnce } from "./common";
import { n8 } from "./format";

/* Transfer: move funds BETWEEN THE WALLETS OF A SINGLE ACCOUNT: spot ↔
   futures, and from the Funding wallet where deposits land on Bybit, OKX,
   KuCoin, Binance. No withdrawal to an external address exists in
   BytNode-AI. ALWAYS asks (`ALWAYS_ASK`). */

type Wallet = "spot" | "futures" | "funding";
type Args = { account?: string; asset: string; amount: number; from: Wallet; to: Wallet };

const WALLET_PROP = { type: "string", enum: ["spot", "futures", "funding"], description: "`funding`: the deposits wallet (Bybit, OKX, KuCoin, Binance)." };

export const transferTool: Tool<Args> = {
  name: "Transfer",
  policy: { alwaysAsk: true },
  description:
    "Moves an asset between the wallets of the same account: spot ↔ futures, or from the Funding wallet (where deposits land on Bybit, OKX, KuCoin, Binance) to trading. Internal to the account only — no external withdrawal exists. The user must authorize each transfer.",
  parameters: {
    type: "object",
    properties: {
      asset: { type: "string", description: "The asset: `USDT`, `BTC`…" },
      amount: { type: "number", minimum: 0 },
      from: WALLET_PROP,
      to: WALLET_PROP,
      account: ACCOUNT_PROP,
    },
    required: ["asset", "amount", "from", "to"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (args.from === args.to) return fail("`from` and `to` must differ.");
    if (!(args.amount > 0)) return fail("`amount` must be positive.");
    const r = await resolve(args, ctx, "spot");
    if ("error" in r) return fail(r.error);
    const info = exchangeInfo(r.account.exchange);
    const viaFunding = args.from === "funding" || args.to === "funding";
    if (viaFunding && !info?.funding) {
      return fail(`${info?.label ?? r.account.exchange} has no separate Funding wallet: deposits land directly on the trading account.`);
    }
    if (!viaFunding && info && !info.transfer) return fail(`${info.label}: no spot ↔ futures transfer through the API. ${info.note ?? ""}`.trim());
    /* The ccxt name of each wallet: `swap` for futures; the Funding by its
       name on this exchange; and, from the Funding, the trading account as
       the exchange sees it (Bybit: "unified"). */
    const ccxtWallet = (w: Wallet) => {
      if (w === "funding") return info?.funding ?? "funding";
      if (viaFunding && info?.tradingWallet) return info.tradingWallet;
      return w === "futures" ? "swap" : "spot";
    };
    const asset = args.asset.trim().toUpperCase();
    /* ⚠️ Sent ONCE (`sendOnce`): a transfer re-sent after a lost answer
       moves the funds twice. */
    return attempt(async () => {
      const t = (await sendOnce(
        () => r.ex.transfer(asset, args.amount, ccxtWallet(args.from), ccxtWallet(args.to)),
        (detail) =>
          `Outcome UNKNOWN: the transfer of ${n8(args.amount)} ${asset} ${args.from} → ${args.to} was sent, but the exchange's answer was lost — ${detail} ` +
          `It may have been done. Do NOT send it again: first check ExchangeBalance on both wallets (${args.from} and ${args.to}).`,
      )) as { id?: string };
      return ok(`Transfer${t?.id ? ` #${t.id}` : ""}: ${n8(args.amount)} ${asset} ${args.from} → ${args.to}.`);
    });
  },
};
