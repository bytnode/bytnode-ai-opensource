/* ---------------------------------------------------------------------------
   Bybit's savings side, day by day: the Funding wallet (where deposits land)
   and Earn, as one pot per coin — next to the Unified trading account,
   whose own ledger rebuilds its balances.

   Earn is known every day: each daily interest payment carries the amount
   that earned it (`effectiveStakingAmount`, the balance at the end of the
   day before). Funding has no ledger at Bybit: it is walked back from
   today's balance through what is known to have moved it — deposits,
   withdrawals, transfers to and from the trading account, conversions,
   the money that went into or came out of Earn. Where the walk would need
   a balance under zero, money left the pot through a way the API does not
   show (a card payment, a P2P sale, Bybit Pay): that amount is reported as
   an outflow of its day, never counted as a loss.
   Pure, tested.
--------------------------------------------------------------------------- */

export type SavingsInputs = {
  /** Today's Funding balances, by coin. */
  fundNow: Record<string, number>;
  /** Today's Earn balances, by coin. */
  earnNow: Record<string, number>;
  /** Earn's daily interest rows: the staked amount behind each. */
  earnRows: Array<{ t: number; coin: string; staked: number }>;
  /** Everything known to have moved the pot (positive: into it) — a
      deposit, a withdrawal and its fee, a transfer to or from the trading
      account, a conversion, an interest payment. */
  events: Array<{ t: number; coin: string; delta: number }>;
};

export type Savings = {
  /** Funding + Earn at the end of each day, by coin. */
  balances: Record<string, Record<string, number>>;
  /** Money that left the pot (negative) without a record the API gives. */
  unexplained: Array<{ day: string; coin: string; amount: number }>;
};

const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const EPSILON = 1e-6;

/** Earn's balance of each coin at the end of each day: a row dated D gives
    the balance at the end of D − 1; after the last row, today's. */
export function earnByDay(rows: SavingsInputs["earnRows"], earnNow: Record<string, number>, days: string[]): Record<string, Record<string, number>> {
  const coins = [...new Set([...rows.map((r) => r.coin), ...Object.keys(earnNow)])];
  const byCoin = new Map(coins.map((c) => [c, rows.filter((r) => r.coin === c).map((r) => ({ day: dayOf(r.t - DAY), staked: r.staked })).sort((a, b) => a.day.localeCompare(b.day))]));
  const out: Record<string, Record<string, number>> = {};
  for (const day of days) {
    out[day] = {};
    for (const coin of coins) {
      const list = byCoin.get(coin) ?? [];
      const last = list[list.length - 1];
      let amount = 0;
      if (last && day > last.day) amount = earnNow[coin] ?? 0;
      else for (const r of list) if (r.day <= day) amount = r.staked;
      if (amount > 0) out[day][coin] = amount;
    }
  }
  return out;
}

export function savingsByDay(inputs: SavingsInputs, days: string[]): Savings {
  const sorted = [...days].sort();
  const earn = earnByDay(inputs.earnRows, inputs.earnNow, sorted);
  const known: Record<string, Record<string, number>> = {};
  for (const e of inputs.events) {
    const day = dayOf(e.t);
    known[day] ??= {};
    known[day][e.coin] = (known[day][e.coin] ?? 0) + e.delta;
  }
  const coins = [...new Set([...Object.keys(inputs.fundNow), ...inputs.events.map((e) => e.coin), ...Object.values(earn).flatMap((d) => Object.keys(d))])];
  const fund: Record<string, number> = Object.fromEntries(coins.map((c) => [c, inputs.fundNow[c] ?? 0]));
  const balances: Savings["balances"] = {};
  const unexplained: Savings["unexplained"] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const day = sorted[i];
    balances[day] = {};
    for (const c of coins) {
      const total = fund[c] + (earn[day][c] ?? 0);
      if (total > EPSILON) balances[day][c] = total;
    }
    if (i === 0) break;
    /* The day before: what this day brought taken back, what went into
       Earn this day given back to Funding. */
    const before = sorted[i - 1];
    for (const c of coins) {
      const candidate = fund[c] - (known[day]?.[c] ?? 0) + ((earn[day][c] ?? 0) - (earn[before][c] ?? 0));
      if (candidate < -EPSILON) unexplained.push({ day, coin: c, amount: candidate });
      fund[c] = candidate > EPSILON ? candidate : 0;
    }
  }
  return { balances, unexplained: unexplained.reverse() };
}

/** Today's holdings without the savings side's: what the trading account
    holds (a rounding under zero is zero). */
export function tradingPart(current: Record<string, number>, ...parts: Array<Record<string, number>>): Record<string, number> {
  const out = { ...current };
  for (const part of parts) for (const [c, v] of Object.entries(part)) out[c] = Math.max(0, (out[c] ?? 0) - v);
  return out;
}

/** Two day-by-day balances added, coin by coin. */
export function addBalances(a: Record<string, Record<string, number>>, b: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const day of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[day] = { ...a[day] };
    for (const [c, v] of Object.entries(b[day] ?? {})) out[day][c] = (out[day][c] ?? 0) + v;
  }
  return out;
}
