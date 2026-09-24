import type { Candle } from "../shared/candle";

/* ---------------------------------------------------------------------------
   The portfolio's performance over a period, from its daily series
   (`dailySeries`): the return, the high and the low, the deepest fall
   from a high (max drawdown), the best and the worst day, and the
   volatility — the standard deviation of the daily returns, annualized
   over 365 days (crypto trades every day). What a wealth report shows.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Period = "7d" | "30d" | "90d" | "1y";

export const PERIODS: Array<{ value: Period; label: string; days: number }> = [
  { value: "7d", label: "7D", days: 7 },
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "1y", label: "1Y", days: 365 },
];

/** The series over the period: its last `days` days, and the day before
    them (the return starts from there). */
export function slicePeriod(series: Candle[], period: Period): Candle[] {
  const days = PERIODS.find((p) => p.value === period)?.days ?? 30;
  return series.slice(-(days + 1));
}

export type DayMove = { t: number; pct: number };

/** Each day's move, in %, against the day before. */
export function dailyReturns(series: Candle[]): DayMove[] {
  const out: DayMove[] = [];
  for (let i = 1; i < series.length; i++) {
    const before = series[i - 1].c;
    if (before > 0) out.push({ t: series[i].t, pct: ((series[i].c - before) / before) * 100 });
  }
  return out;
}

export type Performance = {
  start: number;
  end: number;
  change: number;
  /** In %. */
  pct: number;
  high: number;
  low: number;
  /** The deepest fall from a previous high, in % (0 or negative). */
  maxDrawdown: number;
  best: DayMove | null;
  worst: DayMove | null;
  /** Annualized, in %; null under two daily moves. */
  volatility: number | null;
  days: number;
};

export function performance(series: Candle[]): Performance | null {
  if (series.length < 2) return null;
  const values = series.map((b) => b.c);
  const start = values[0];
  const end = values[values.length - 1];
  let peak = values[0];
  let maxDrawdown = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, ((v - peak) / peak) * 100);
  }
  const moves = dailyReturns(series);
  const best = moves.reduce<DayMove | null>((b, m) => (!b || m.pct > b.pct ? m : b), null);
  const worst = moves.reduce<DayMove | null>((w, m) => (!w || m.pct < w.pct ? m : w), null);
  let volatility: number | null = null;
  if (moves.length >= 2) {
    const mean = moves.reduce((s, m) => s + m.pct, 0) / moves.length;
    const variance = moves.reduce((s, m) => s + (m.pct - mean) ** 2, 0) / (moves.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(365);
  }
  return {
    start,
    end,
    change: end - start,
    pct: start > 0 ? ((end - start) / start) * 100 : 0,
    high: Math.max(...values),
    low: Math.min(...values),
    maxDrawdown,
    best,
    worst,
    volatility,
    days: series.length - 1,
  };
}
