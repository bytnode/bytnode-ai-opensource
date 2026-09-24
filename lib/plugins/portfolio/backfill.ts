import type { Candle } from "../shared/candle";
import { STABLES, type Snapshot } from "./aggregate";

/* ---------------------------------------------------------------------------
   The history before the snapshots, day by day and per account: the real
   balances rebuilt from the exchange's ledger (below), or — for an
   exchange without one — today's holdings held all along, an estimate the
   view names. Valued at each day's close; a real daily snapshot always
   wins over it for its day.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Holdings = Array<{ id: string; assets: Array<{ asset: string; amount: number }> }>;

export type Estimated = Snapshot & { estimated: true };

/** The history the view draws: the estimate, and every real snapshot in
    place of its day. */
export function mergeHistory(real: Snapshot[], estimated: Snapshot[]): Snapshot[] {
  const byDay = new Map(estimated.map((p) => [p.date, p]));
  for (const p of real) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* --- The real history, from an exchange's ledger ---------------------------

   An exchange's ledger lists every change of a balance — a trade, a fee, a
   deposit, a withdrawal, a transfer, a funding payment. Walked back from
   today's balances, it gives the real balance of each asset at the end of
   each past day; valued at that day's close, the account's real value. */

/** A change of one balance; `flow`: money moved in or out of the account
    (a deposit, a withdrawal, a transfer), not a gain or a loss. */
export type Move = { t: number; asset: string; delta: number; flow?: boolean };

/** The ledger entry's fields a move is read from (ccxt's `LedgerEntry`). */
export type LedgerLike = { timestamp?: number; currency?: string; amount?: number; direction?: string; before?: number; after?: number; type?: string; info?: unknown };

/** The exchanges' own names for money moved in or out (Bybit's
    TRANSFER_IN / TRANSFER_OUT, a deposit, a withdrawal). */
const FLOW_TYPE = /transfer|deposit|withdraw/i;

/** An entry as a signed move. The sign comes from the exchange's own
    signed change when it gives one, else from ccxt's direction and amount —
    never from `after − before`: ccxt's Bybit parser computes `before`
    wrongly for every outgoing entry (after − |amount| instead of
    after + |amount|), which turned every move into money coming in. */
export function ledgerMove(e: LedgerLike): Move | null {
  const t = e.timestamp;
  const asset = e.currency;
  if (typeof t !== "number" || !asset) return null;
  const info = (e.info ?? {}) as Record<string, unknown>;
  let delta: number | undefined;
  if ((typeof info.change === "string" && info.change !== "") || typeof info.change === "number") delta = Number(info.change);
  else if (typeof e.amount === "number") delta = (e.direction === "out" ? -1 : 1) * Math.abs(e.amount);
  else if (typeof e.before === "number" && typeof e.after === "number") delta = e.after - e.before;
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return null;
  const kind = String(info.type ?? e.type ?? "");
  return { t, asset: asset.toUpperCase(), delta, ...(FLOW_TYPE.test(kind) ? { flow: true } : {}) };
}

const END_OF_DAY = (day: string) => Date.parse(`${day}T23:59:59.999Z`);

/** The last `n` UTC days up to `now`'s, oldest first. */
export function lastDays(now: Date, n: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Each day's balances: today's, minus every move made after that day
    ended (a rounding under zero is zero). */
export function balancesByDay(current: Record<string, number>, moves: Move[], days: string[]): Record<string, Record<string, number>> {
  const sorted = [...moves].sort((a, b) => b.t - a.t);
  const balance = { ...current };
  const out: Record<string, Record<string, number>> = {};
  let i = 0;
  for (const day of [...days].sort().reverse()) {
    const end = END_OF_DAY(day);
    for (; i < sorted.length && sorted[i].t > end; i++) balance[sorted[i].asset] = (balance[sorted[i].asset] ?? 0) - sorted[i].delta;
    out[day] = Object.fromEntries(Object.entries(balance).map(([a, v]) => [a, v > 1e-12 ? v : 0]));
  }
  return out;
}

/** An asset's close on a day: that day's, else the latest before it,
    else the first known; undefined without any. */
export function closeOn(bars: Candle[] | undefined, day: string): number | undefined {
  if (!bars?.length) return undefined;
  const end = END_OF_DAY(day);
  let found: number | undefined;
  for (const b of bars) {
    if (b.t <= end) found = b.c;
    else break;
  }
  return found ?? bars[0].c;
}

/** Each day's value of the balances, a stablecoin at one dollar; the
    assets without any price are named in `missing`. */
export function valueByDay(balances: Record<string, Record<string, number>>, closes: Record<string, Candle[]>): { values: Record<string, number>; missing: string[] } {
  const missing = new Set<string>();
  const values: Record<string, number> = {};
  for (const [day, held] of Object.entries(balances)) {
    let usd = 0;
    for (const [asset, amount] of Object.entries(held)) {
      if (!(amount > 0)) continue;
      const price = STABLES.has(asset) ? 1 : closeOn(closes[asset], day);
      if (price === undefined) missing.add(asset);
      else usd += amount * price;
    }
    values[day] = Math.round(usd * 100) / 100;
  }
  return { values, missing: [...missing] };
}

/* --- What the exchanges said: activity, coverage, money in and out ------- */

export type Activity = { t: number; kind: "buy" | "sell" | "deposit" | "withdrawal"; asset: string; amount: number; price?: number; symbol?: string; account: string };

/** How far an exchange's history reached, for one kind of record. */
export type Coverage = { status: "ok" | "limited" | "unsupported" | "error"; from?: string; note?: string };

/** The money moved in and out of an account each day, from its ledger's
    flows, in USD at that day's close. For an account whose balances come
    from its ledger this is what must be taken off the performance: the
    same records that moved the curve (a deposit that landed in Bybit's
    funding wallet moves the trading account only when transferred in). */
export function flowsOfMoves(moves: Move[], closes: Record<string, Candle[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of moves) {
    if (!m.flow) continue;
    const day = new Date(m.t).toISOString().slice(0, 10);
    const price = STABLES.has(m.asset) ? 1 : closeOn(closes[m.asset], day);
    if (price === undefined) continue;
    out[day] = Math.round(((out[day] ?? 0) + m.delta * price) * 100) / 100;
  }
  return out;
}

/** The money put in (deposits, positive) and taken out (withdrawals,
    negative) each day, in USD at that day's close; per account id. */
export function flowsByDay(activity: Activity[], closes: Record<string, Candle[]>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const a of activity) {
    if (a.kind !== "deposit" && a.kind !== "withdrawal") continue;
    const day = new Date(a.t).toISOString().slice(0, 10);
    const price = STABLES.has(a.asset) ? 1 : closeOn(closes[a.asset], day);
    if (price === undefined) continue;
    const usd = (a.kind === "deposit" ? 1 : -1) * a.amount * price;
    out[a.account] ??= {};
    out[a.account][day] = Math.round(((out[a.account][day] ?? 0) + usd) * 100) / 100;
  }
  return out;
}
