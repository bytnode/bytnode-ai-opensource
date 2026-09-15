import type { Tool } from "../types";
import { fail, ok } from "../types";
import { exchangeInfo } from "./catalog";
import { ACCOUNT_PROP, attempt, resolve } from "./common";
import { n8 } from "./format";

/* Transfer : deplacer des fonds ENTRE LES PORTEFEUILLES D'UN MEME COMPTE
   (spot ↔ futures). Aucun retrait vers une adresse externe n'existe dans
   BytNode-AI. Demande TOUJOURS (`ALWAYS_ASK`). */

type Wallet = "spot" | "futures";
type Args = { account?: string; asset: string; amount: number; from: Wallet; to: Wallet };

const WALLET_PROP = { type: "string", enum: ["spot", "futures"] };
const ccxtWallet = (w: Wallet) => (w === "futures" ? "swap" : "spot");

export const transferTool: Tool<Args> = {
  name: "Transfer",
  description: "Déplace un actif entre le portefeuille spot et le portefeuille futures du même compte. Interne au compte uniquement — aucun retrait externe n'existe. L'utilisateur doit autoriser chaque transfert.",
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
    if (info && !info.transfer) return fail(`${info.label} : pas de transfert spot ↔ futures par l'API. ${info.note ?? ""}`.trim());
    const asset = args.asset.trim().toUpperCase();
    return attempt(async () => {
      const t = (await r.ex.transfer(asset, args.amount, ccxtWallet(args.from), ccxtWallet(args.to))) as { id?: string };
      return ok(`Transfert${t?.id ? ` #${t.id}` : ""} : ${n8(args.amount)} ${asset} ${args.from} → ${args.to}.`);
    });
  },
};
