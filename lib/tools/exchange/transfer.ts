import type { Tool } from "../types";
import { fail, ok } from "../types";
import { exchangeInfo } from "./catalog";
import { ACCOUNT_PROP, attempt, resolve } from "./common";
import { n8 } from "./format";

/* Transfer : deplacer des fonds ENTRE LES PORTEFEUILLES D'UN MEME COMPTE :
   spot ↔ futures, et depuis le portefeuille Funding ou arrivent les depots
   sur Bybit, OKX, KuCoin, Binance. Aucun retrait vers une adresse externe
   n'existe dans BytNode-AI. Demande TOUJOURS (`ALWAYS_ASK`). */

type Wallet = "spot" | "futures" | "funding";
type Args = { account?: string; asset: string; amount: number; from: Wallet; to: Wallet };

const WALLET_PROP = { type: "string", enum: ["spot", "futures", "funding"], description: "`funding` : le portefeuille des dépôts (Bybit, OKX, KuCoin, Binance)." };

export const transferTool: Tool<Args> = {
  name: "Transfer",
  description:
    "Déplace un actif entre les portefeuilles du même compte : spot ↔ futures, ou depuis le portefeuille Funding (où arrivent les dépôts sur Bybit, OKX, KuCoin, Binance) vers le trading. Interne au compte uniquement — aucun retrait externe n'existe. L'utilisateur doit autoriser chaque transfert.",
  parameters: {
    type: "object",
    properties: {
      asset: { type: "string", description: "L'actif : `USDT`, `BTC`…" },
      amount: { type: "number", minimum: 0 },
      from: WALLET_PROP,
      to: WALLET_PROP,
      account: ACCOUNT_PROP,
    },
    required: ["asset", "amount", "from", "to"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (args.from === args.to) return fail("`from` et `to` doivent différer.");
    if (!(args.amount > 0)) return fail("`amount` doit être positif.");
    const r = await resolve(args, ctx, "spot");
    if ("error" in r) return fail(r.error);
    const info = exchangeInfo(r.account.exchange);
    const viaFunding = args.from === "funding" || args.to === "funding";
    if (viaFunding && !info?.funding) {
      return fail(`${info?.label ?? r.account.exchange} n'a pas de portefeuille Funding distinct : les dépôts arrivent directement sur le compte de trading.`);
    }
    if (!viaFunding && info && !info.transfer) return fail(`${info.label} : pas de transfert spot ↔ futures par l'API. ${info.note ?? ""}`.trim());
    /* Le nom ccxt de chaque portefeuille : `swap` pour les futures ; le
       Funding par son nom chez cet exchange ; et, depuis le Funding, le
       compte de trading tel que l'exchange le voit (Bybit : « unified »). */
    const ccxtWallet = (w: Wallet) => {
      if (w === "funding") return info?.funding ?? "funding";
      if (viaFunding && info?.tradingWallet) return info.tradingWallet;
      return w === "futures" ? "swap" : "spot";
    };
    const asset = args.asset.trim().toUpperCase();
    return attempt(async () => {
      const t = (await r.ex.transfer(asset, args.amount, ccxtWallet(args.from), ccxtWallet(args.to))) as { id?: string };
      return ok(`Transfert${t?.id ? ` #${t.id}` : ""} : ${n8(args.amount)} ${asset} ${args.from} → ${args.to}.`);
    });
  },
};
