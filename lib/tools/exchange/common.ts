import { randomUUID } from "node:crypto";
import type { Exchange } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { ToolContext, ToolResult } from "../types";
import { fail } from "../types";
import { pickAccount } from "./accounts";
import { exchangeInfo } from "./catalog";
import { clientFor } from "./client";
import { describeExchangeError, isTransientExchangeError, withRetry } from "./errors";
import { n8 } from "./format";
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
    otherwise. An action sent through `sendOnce` inside `fn` is never part
    of that second attempt: its `OutcomeUnknown` is not transient, so the
    retry only ever replays the READS that came before the send. */
export async function attempt(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await withRetry(fn);
  } catch (e) {
    if (e instanceof OutcomeUnknown) return fail(e.message);
    return fail(describeExchangeError(e));
  }
}

/* ⚠️ An ACTION (an order, a close, a transfer) is sent ONCE. A timeout or a
   dropped connection after the request left says nothing about the
   exchange: it may have executed it and only its answer was lost. Sending
   it again would place a second order on the user's single consent — so
   the outcome is said UNKNOWN and the agent is told to check before
   anything else. A lost or unreadable answer (BadResponse, NullResponse)
   is the same case. */
const UNKNOWN_AFTER_SEND = new Set(["BadResponse", "NullResponse"]);

export class OutcomeUnknown extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeUnknown";
  }
}

/** Sends one action that moves money or a position, never retried. On a
    transient error, throws `OutcomeUnknown` carrying `notice(detail)` —
    what was sent and what to check before trying again. */
export async function sendOnce<T>(send: () => Promise<T>, notice: (detail: string) => string): Promise<T> {
  try {
    return await send();
  } catch (e) {
    if (isTransientExchangeError(e) || (e instanceof Error && UNKNOWN_AFTER_SEND.has(e.name))) throw new OutcomeUnknown(notice(describeExchangeError(e)));
    throw e;
  }
}

/** The client id put on an order so that, if its answer is lost, it can be
    found among the account's orders (`ExchangeOrders` shows it). Every
    ccxt class of the catalog maps `clientOrderId` to the exchange's own
    field; the format fits them all — 16 letters and digits, not starting
    with `t` (Gate prefixes `t-` otherwise), under Kraken's 18 characters
    and Gate's 28. ⚠️ HTX futures only take a NUMBER there, and ccxt then
    forwards a text id raw into the request: none is sent on HTX futures. */
export function orderClientId(exchangeId: string, market: Market): string | undefined {
  if (exchangeId === "htx" && market === "futures") return undefined;
  return `${CLIENT_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export const CLIENT_ID_PREFIX = "bnai";

/** The size of one contract in base asset on a contract market (OKX BTC
    swap: 0.01 BTC), 1 elsewhere. ⚠️ ccxt counts the `amount` of a contract
    market in CONTRACTS, and its precision and minimum too. */
export function contractSizeOf(market: { contractSize?: number } | undefined): number {
  const cs = market?.contractSize;
  return typeof cs === "number" && cs > 0 ? cs : 1;
}

/** A quantity counted in contracts, said in base asset then in contracts:
    `0.1 BTC (10 contracts)`. Only for a contract size other than 1 — the
    two numbers are the same otherwise. */
export function unitsText(contracts: number, cs: number, base: string | undefined): string {
  return `${n8(contracts * cs)} ${base ?? "base"} (${n8(contracts)} contract${contracts === 1 ? "" : "s"})`;
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

/** The exchanges whose ccxt class reads `triggerDirection`, on futures:
    Bybit (required on contracts, REFUSED on spot) and KuCoin (its futures
    class, `kucoinfutures`; required on a unified account). ⚠️ Everywhere
    else ccxt forwards an unknown parameter raw into the request, and
    Binance refuses any parameter it did not read (-1104): stop orders on
    Binance, OKX, Gate… failed. */
const TRIGGER_DIRECTION = new Set(["bybit", "kucoin", "kucoinfutures"]);

/** The direction of a trigger order, for the exchanges that require it
    (see `TRIGGER_DIRECTION`): `ascending` if the price must rise to the
    trigger. `undefined` everywhere else: the parameter is then not sent. */
export async function triggerDirection(ex: Exchange, symbol: string, market: Market, stop: number): Promise<"ascending" | "descending" | undefined> {
  if (market !== "futures" || !TRIGGER_DIRECTION.has(ex.id)) return undefined;
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
