import type { Exchange } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { ToolContext, ToolResult } from "../types";
import { fail } from "../types";
import { pickAccount } from "./accounts";
import { exchangeInfo } from "./catalog";
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
  const info = exchangeInfo(picked.account.exchange);
  if (market === "futures" && info?.futures === "none") return { error: `${info.label} : spot seulement. ${info.note ?? ""}`.trim() };
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

/** Les outils d'action sur les futures d'un exchange qui ne les permet pas
    par l'API (MEXC) : la raison, sinon `undefined`. */
export function futuresActionError(account: ExchangeAccount, market: Market): string | undefined {
  const info = exchangeInfo(account.exchange);
  if (market === "futures" && info?.futures === "read") return `${info.label} : futures en lecture seule. ${info.note ?? ""}`.trim();
  return undefined;
}

const HEDGE = "Ce compte est en hedge mode : les outils ne gèrent que le one-way. Repassez en one-way sur l'exchange.";

/** Refuse le hedge mode (long et short a la fois) : les outils ne savent
    que le one-way. `undefined` si l'exchange ne le dit pas. Bybit et
    Bitget n'ont pas `fetchPositionMode` dans ccxt : on lit le mode la ou
    ils le publient (l'index de position, le compte). */
export async function hedgeModeError(ex: Exchange, symbol: string): Promise<string | undefined> {
  try {
    if (ex.has["fetchPositionMode"]) {
      const mode = (await ex.fetchPositionMode(symbol)) as { hedged?: boolean } | undefined;
      return mode?.hedged ? HEDGE : undefined;
    }
    if (ex.id === "bybit" && ex.has["fetchPositions"]) {
      const positions = (await ex.fetchPositions([symbol])) as Array<{ info?: { positionIdx?: string | number } }>;
      return positions.some((p) => String(p.info?.positionIdx ?? "0") !== "0") ? HEDGE : undefined;
    }
    if (ex.id === "bitget") {
      const market = ex.markets?.[symbol] as { id?: string; settle?: string } | undefined;
      const call = (ex as unknown as { privateMixGetV2MixAccountAccount?: (p: Record<string, string>) => Promise<{ data?: { posMode?: string } }> }).privateMixGetV2MixAccountAccount;
      if (!call || !market?.id) return undefined;
      const res = await call.call(ex, { symbol: market.id, productType: `${market.settle ?? "USDT"}-FUTURES`, marginCoin: market.settle ?? "USDT" });
      return res?.data?.posMode === "hedge_mode" ? HEDGE : undefined;
    }
  } catch {
    /* pas grave : l'exchange tranchera */
  }
  return undefined;
}

/** Le sens d'un ordre a declenchement, pour les exchanges qui l'exigent
    (Bybit et KuCoin en futures) : `ascending` si le prix doit monter
    jusqu'au declencheur. Bybit le REFUSE en spot. */
export async function triggerDirection(ex: Exchange, symbol: string, market: Market, stop: number): Promise<"ascending" | "descending" | undefined> {
  if (ex.id === "bybit" && market === "spot") return undefined;
  const t = (await ex.fetchTicker(symbol)) as { last?: number | null };
  if (typeof t.last !== "number") return undefined;
  return stop > t.last ? "ascending" : "descending";
}

/** `since` accepte une date ISO ou des millisecondes. */
export function sinceMs(since: string | number | undefined): number | undefined {
  if (since === undefined || since === "") return undefined;
  const n = typeof since === "number" ? since : /^\d+$/.test(since) ? Number(since) : Date.parse(since);
  return Number.isFinite(n) ? n : undefined;
}
