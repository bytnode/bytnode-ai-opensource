import type { LedgerEntry, Trade, Transaction } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError, withRetry } from "@/lib/tools/exchange/errors";
import { ledgerMove, type Activity, type Coverage, type LedgerLike, type Move } from "./backfill";

/* ---------------------------------------------------------------------------
   An account's history, read from its exchange through ccxt — read-only
   calls only: the ledger (every change of a balance), the trades, the
   deposits and the withdrawals, over the period asked (up to a year).

   Exchanges answer a limited range per request (Bybit: seven days for the
   ledger and the trades, thirty for the deposits and withdrawals), so the
   period is read window by window, oldest first, each window paged. A
   window the exchange refuses as too old is where its history stops: the
   first window it answers is reported as "available since" — the view
   tells the user, it never pretends. A network error is retried once.
   Binance's "ledger" in ccxt is the futures income only, not the wallets:
   it is not used for the balances (the trades and transfers still are).
   Kept an hour per account: the past does not move. SERVER-ONLY.
--------------------------------------------------------------------------- */

const DAY = 86_400_000;
const TTL = 60 * 60_000;
/** The most kept per list for the view (the newest). */
const KEEP = 300;

/** Days per request, where an exchange bounds its ranges. */
const WINDOWS: Record<string, Partial<Record<Kind, number>>> = {
  bybit: { ledger: 7, trades: 7, deposits: 30, withdrawals: 30 },
};
/** Exchanges whose ccxt "ledger" is not the wallets' history. */
const NOT_WALLETS = new Set(["binance", "binanceusdm", "binancecoinm"]);

type Kind = "ledger" | "trades" | "deposits" | "withdrawals";

export type AccountHistory = {
  moves: Move[] | null;
  activity: Activity[];
  coverage: Record<Kind, Coverage>;
};

const cache = new Map<string, { at: number; value: AccountHistory }>();

/** A refusal that means "too far back" rather than a failure. */
const TOO_OLD = /range|too (old|early|far)|time|exceed|before|days|history|startTime|start_time|interval/i;

/** Reads one kind over [since, now], window by window (or in one paged
    call when the exchange takes any range). */
async function windows<T>(kind: Kind, exchange: string, since: number, now: number, read: (start: number, end: number | undefined) => Promise<T[]>): Promise<{ rows: T[]; coverage: Coverage }> {
  const days = WINDOWS[exchange]?.[kind];
  if (!days) {
    try {
      const rows = await withRetry(() => read(since, undefined));
      return { rows, coverage: { status: "ok", from: new Date(since).toISOString() } };
    } catch (e) {
      const message = describeExchangeError(e);
      return { rows: [], coverage: { status: TOO_OLD.test(message) ? "limited" : "error", note: message } };
    }
  }
  const rows: T[] = [];
  let from: number | null = null;
  let refused: string | null = null;
  for (let start = since; start < now; start += days * DAY) {
    const end = Math.min(start + days * DAY - 1, now);
    try {
      rows.push(...(await withRetry(() => read(start, end))));
      from ??= start;
    } catch (e) {
      const message = describeExchangeError(e);
      /* Refused before anything was read: older than the exchange keeps —
         go on to the next window. Refused after: a real failure. */
      if (from === null && TOO_OLD.test(message)) {
        refused = message;
        continue;
      }
      return { rows, coverage: { status: "error", ...(from !== null ? { from: new Date(from).toISOString() } : {}), note: message } };
    }
  }
  if (from === null) return { rows, coverage: { status: refused ? "limited" : "ok", note: refused ?? undefined } };
  return { rows, coverage: from > since ? { status: "limited", from: new Date(from).toISOString(), note: `The exchange answers only since ${new Date(from).toISOString().slice(0, 10)}.` } : { status: "ok", from: new Date(from).toISOString() } };
}

const unique = <T,>(rows: T[], key: (r: T) => string) => {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Everything the exchange can say about the account since `since`. */
export async function readHistory(account: ExchangeAccount, since: number, heldAssets: string[], now = Date.now()): Promise<AccountHistory> {
  const key = `${account.id}|${Math.floor(since / DAY)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.value;

  const none = (note: string): Coverage => ({ status: "unsupported", note });
  const coverage: Record<Kind, Coverage> = { ledger: none("Not offered by this exchange."), trades: none("Not offered by this exchange."), deposits: none("Not offered by this exchange."), withdrawals: none("Not offered by this exchange.") };
  let moves: Move[] | null = null;
  const activity: Activity[] = [];
  let ex;
  try {
    ex = await withRetry(() => clientFor(account, "spot"));
  } catch (e) {
    const note = describeExchangeError(e);
    const failed: Coverage = { status: "error", note };
    return { moves: null, activity: [], coverage: { ledger: failed, trades: failed, deposits: failed, withdrawals: failed } };
  }
  const id = ex.id;

  /* The ledger: the balances' own history. */
  if (NOT_WALLETS.has(id)) coverage.ledger = none("This exchange's ledger covers the futures income only, not the wallets.");
  else if (ex.has["fetchLedger"]) {
    const r = await windows<LedgerEntry>("ledger", id, since, now, (start, end) => ex.fetchLedger(undefined, start, id === "bybit" ? 50 : undefined, { ...(end ? (id === "bybit" ? { endTime: end } : { until: end }) : {}), paginate: true, paginationCalls: 40 }) as Promise<LedgerEntry[]>);
    coverage.ledger = r.coverage;
    if (r.coverage.status !== "error") moves = unique(r.rows, (e) => String(e.id ?? `${e.timestamp}|${e.currency}|${e.amount}|${e.after}`)).flatMap((e) => ledgerMove(e as LedgerLike) ?? []).filter((m) => m.t >= since);
  }

  /* The trades: Bybit by category, the others by the pairs held. */
  if (ex.has["fetchMyTrades"]) {
    const read = async (start: number, end: number | undefined): Promise<Trade[]> => {
      const range = end ? { until: end } : {};
      if (id === "bybit") {
        const out: Trade[] = [];
        for (const type of ["spot", "linear"]) out.push(...((await ex.fetchMyTrades(undefined, start, 100, { ...range, type, paginate: true, paginationCalls: 30 })) as Trade[]));
        return out;
      }
      const out: Trade[] = [];
      for (const asset of heldAssets) {
        const symbol = `${asset}/USDT`;
        if (!ex.markets?.[symbol]) continue;
        out.push(...((await ex.fetchMyTrades(symbol, start, undefined, { ...range, paginate: true, paginationCalls: 20 })) as Trade[]));
      }
      return out;
    };
    const r = await windows<Trade>("trades", id, since, now, read);
    coverage.trades = { ...r.coverage, ...(id !== "bybit" && r.coverage.status === "ok" ? { note: "The pairs held today, against USDT." } : {}) };
    for (const t of unique(r.rows, (x) => String(x.id ?? `${x.timestamp}|${x.symbol}|${x.amount}`))) {
      if (typeof t.timestamp !== "number" || typeof t.amount !== "number") continue;
      activity.push({ t: t.timestamp, kind: t.side === "sell" ? "sell" : "buy", asset: String(t.symbol ?? "").split("/")[0], amount: t.amount, price: t.price, symbol: String(t.symbol ?? ""), account: account.id });
    }
  }

  /* Deposits and withdrawals: the money in and out. */
  for (const kind of ["deposits", "withdrawals"] as const) {
    const has = kind === "deposits" ? ex.has["fetchDeposits"] : ex.has["fetchWithdrawals"];
    if (!has) continue;
    const r = await windows<Transaction>(kind, id, since, now, (start, end) =>
      (kind === "deposits" ? ex.fetchDeposits(undefined, start, undefined, { ...(end ? { until: end } : {}), paginate: true, paginationCalls: 20 }) : ex.fetchWithdrawals(undefined, start, undefined, { ...(end ? { until: end } : {}), paginate: true, paginationCalls: 20 })) as Promise<Transaction[]>,
    );
    coverage[kind] = r.coverage;
    for (const x of unique(r.rows, (y) => String(y.id ?? y.txid ?? `${y.timestamp}|${y.currency}|${y.amount}`))) {
      if (typeof x.timestamp !== "number" || typeof x.amount !== "number" || !x.currency) continue;
      if (x.status && !/ok|complete|success|done/i.test(String(x.status))) continue;
      activity.push({ t: x.timestamp, kind: kind === "deposits" ? "deposit" : "withdrawal", asset: x.currency.toUpperCase(), amount: Math.abs(x.amount), account: account.id });
    }
  }

  /* Every deposit and withdrawal (the performance needs them all), the
     newest trades. */
  const sorted = activity.sort((a, b) => b.t - a.t);
  const value: AccountHistory = { moves, activity: [...sorted.filter((a) => a.kind === "deposit" || a.kind === "withdrawal"), ...sorted.filter((a) => a.kind === "buy" || a.kind === "sell").slice(0, KEEP)].sort((a, b) => b.t - a.t), coverage };
  cache.set(key, { at: now, value });
  return value;
}
