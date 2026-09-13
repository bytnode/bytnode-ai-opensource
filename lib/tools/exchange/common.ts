import type { Exchange } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { ToolContext, ToolResult } from "../types";
import { fail } from "../types";
import { pickAccount } from "./accounts";
import { clientFor } from "./client";
import { describeExchangeError, withRetry } from "./errors";
import { toSymbol, type Market } from "./symbols";

/* ---------------------------------------------------------------------------
   Ce que chaque outil exchange fait avant de travailler : trouver le compte,
   ouvrir le client, normaliser le symbole. Et apres : traduire l'erreur.
--------------------------------------------------------------------------- */

export type BaseArgs = { account?: string; market?: Market };

export const ACCOUNT_PROP = { type: "string", description: "Le compte, par son label (« Binance-main »). Obligatoire s'il y a plusieurs comptes." };
export const MARKET_PROP = { type: "string", enum: ["spot", "futures"], description: "Le marché : `spot` (défaut) ou `futures` (perpétuels linéaires USDT)." };
export const SYMBOL_PROP = { type: "string", description: "La paire, format `BTC/USDT` (le suffixe perp est ajouté en futures)." };

export type Resolved = { account: ExchangeAccount; market: Market; ex: Exchange };

export async function resolve(args: BaseArgs, ctx: ToolContext, forced?: Market): Promise<Resolved | { error: string }> {
  const picked = pickAccount(ctx.exchangeAccounts ?? [], args.account);
  if ("error" in picked) return picked;
  const market: Market = forced ?? (args.market === "futures" ? "futures" : "spot");
  try {
    const ex = await withRetry(() => clientFor(picked.account, market));
    return { account: picked.account, market, ex };
  } catch (e) {
    return { error: describeExchangeError(e) };
  }
}

/** Un symbole valide sur cet exchange, ou une erreur qui le dit. */
export function symbolOn(ex: Exchange, raw: string, market: Market): { symbol: string } | { error: string } {
  const symbol = toSymbol(raw, market);
  if (!ex.markets?.[symbol]) return { error: `Marché inconnu sur ${ex.id} : ${symbol}.` };
  return { symbol };
}

/** Execute un appel exchange : un second essai si passager, l'erreur en
    francais sinon. */
export async function attempt(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await withRetry(fn);
  } catch (e) {
    return fail(describeExchangeError(e));
  }
}

/** Refuse le hedge mode (long et short a la fois) : les outils ne savent
    que le one-way. `undefined` si l'exchange ne le dit pas. */
export async function hedgeModeError(ex: Exchange, symbol: string): Promise<string | undefined> {
  if (!ex.has["fetchPositionMode"]) return undefined;
  try {
    const mode = (await ex.fetchPositionMode(symbol)) as { hedged?: boolean } | undefined;
    if (mode?.hedged) return "Ce compte est en hedge mode : les outils ne gèrent que le one-way. Repassez en one-way sur l'exchange.";
  } catch {
    /* pas grave : l'exchange tranchera */
  }
  return undefined;
}

/** `since` accepte une date ISO ou des millisecondes. */
export function sinceMs(since: string | number | undefined): number | undefined {
  if (since === undefined || since === "") return undefined;
  const n = typeof since === "number" ? since : /^\d+$/.test(since) ? Number(since) : Date.parse(since);
  return Number.isFinite(n) ? n : undefined;
}
