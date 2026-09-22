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
   What every exchange tool does before working: find the account, open the
   client, normalize the symbol. And after: translate the error.
--------------------------------------------------------------------------- */

export type BaseArgs = { account?: string; market?: Market };

export const ACCOUNT_PROP = { type: "string", description: "The account, by its label (\"Binance-main\"). Required if there are several accounts." };
export const MARKET_PROP = { type: "string", enum: ["spot", "futures"], description: "The market: `spot` (default) or `futures` (linear USDT perpetuals)." };
export const SYMBOL_PROP = { type: "string", description: "The pair, `BTC/USDT` format (the perp suffix is added on futures)." };

export type Resolved = { account: ExchangeAccount; market: Market; ex: Exchange };

export async function resolve(args: BaseArgs, ctx: ToolContext, forced?: Market): Promise<Resolved | { error: string }> {
  const picked = pickAccount(ctx.exchangeAccounts ?? [], args.account);
  if ("error" in picked) return picked;
  const market: Market = forced ?? (args.market === "futures" ? "futures" : "spot");
  const info = exchangeInfo(picked.account.exchange);
  if (market === "futures" && info?.futures === "none") return { error: `${info.label}: spot only. ${info.note ?? ""}`.trim() };
  try {
    const ex = await withRetry(() => clientFor(picked.account, market));
    return { account: picked.account, market, ex };
  } catch (e) {
    return { error: describeExchangeError(e) };
  }
}

/** A symbol valid on this exchange, or an error saying so. */
export function symbolOn(ex: Exchange, raw: string, market: Market): { symbol: string } | { error: string } {
  const symbol = toSymbol(raw, market);
  if (!ex.markets?.[symbol]) return { error: `Unknown market on ${ex.id}: ${symbol}.` };
  return { symbol };
}

/** Runs an exchange call: a second attempt if transient, a readable error
    otherwise. */
export async function attempt(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await withRetry(fn);
  } catch (e) {
    return fail(describeExchangeError(e));
  }
}

/** The action tools on the futures of an exchange that does not allow them
    through the API (MEXC): the reason, otherwise `undefined`. */
export function futuresActionError(account: ExchangeAccount, market: Market): string | undefined {
  const info = exchangeInfo(account.exchange);
  if (market === "futures" && info?.futures === "read") return `${info.label}: futures read-only. ${info.note ?? ""}`.trim();
  return undefined;
}

const HEDGE = "This account is in hedge mode: the tools only handle one-way. Switch back to one-way on the exchange.";

/** Refuses hedge mode (long and short at once): the tools only know
    one-way. `undefined` if the exchange does not say. Bybit and Bitget
    have no `fetchPositionMode` in ccxt: we read the mode where they
    publish it (the position index, the account). */
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
    /* no matter: the exchange will decide */
  }
  return undefined;
}

/** The direction of a trigger order, for the exchanges that require it
    (Bybit and KuCoin on futures): `ascending` if the price must rise to
    the trigger. Bybit REFUSES it on spot. */
export async function triggerDirection(ex: Exchange, symbol: string, market: Market, stop: number): Promise<"ascending" | "descending" | undefined> {
  if (ex.id === "bybit" && market === "spot") return undefined;
  const t = (await ex.fetchTicker(symbol)) as { last?: number | null };
  if (typeof t.last !== "number") return undefined;
  return stop > t.last ? "ascending" : "descending";
}

/** `since` accepts an ISO date or milliseconds. */
export function sinceMs(since: string | number | undefined): number | undefined {
  if (since === undefined || since === "") return undefined;
  const n = typeof since === "number" ? since : /^\d+$/.test(since) ? Number(since) : Date.parse(since);
  return Number.isFinite(n) ? n : undefined;
}
