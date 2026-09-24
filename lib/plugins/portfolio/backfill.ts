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

export type Move = { t: number; asset: string; delta: number };

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
