import type { Curve } from "./curve";
import type { Fill } from "./engine";

/* ---------------------------------------------------------------------------
   A paper portfolio's record, from its fills: what the view's
   "Performance" shows beside the curve.

   A TRADE is a fill that closes something — a spot sale, a futures fill
   that realized a result, a liquidation — and its result is what it
   realized (gross of its fee; the fees are summed apart). The volume is
   every fill's notional. The drawdown is read on the result curve: the
   deepest fall from a peak, in % of that peak. Pure, tested.
--------------------------------------------------------------------------- */

export type Stats = {
  trades: number;
  wins: number;
  /** In %, when there is at least one trade. */
  winRate?: number;
  best?: number;
  worst?: number;
  /** The mean result of the winning trades, and of the losing ones. */
  avgWin?: number;
  avgLoss?: number;
  fees: number;
  volume: number;
  fills: number;
  /** In %, ≤ 0; undefined without a curve. */
  maxDrawdown?: number;
};

export const isClosing = (f: Fill): boolean => Boolean(f.liquidation) || (f.market === "spot" ? f.side === "sell" : f.realizedPnl !== 0);

export function drawdown(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.min(worst, (v - peak) / peak);
  }
  return worst * 100;
}

export function tradeStats(fills: Fill[], curve?: Curve): Stats {
  const closing = fills.filter(isClosing).map((f) => f.realizedPnl);
  const won = closing.filter((r) => r > 0);
  const lost = closing.filter((r) => r < 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : undefined);
  return {
    trades: closing.length,
    wins: won.length,
    ...(closing.length ? { winRate: (won.length / closing.length) * 100, best: Math.max(...closing), worst: Math.min(...closing) } : {}),
    avgWin: mean(won),
    avgLoss: mean(lost),
    fees: fills.reduce((t, f) => t + f.fee, 0),
    volume: fills.reduce((t, f) => t + f.amount * f.price, 0),
    fills: fills.length,
    maxDrawdown: curve ? drawdown(curve.candles.flatMap((c) => [c.o, c.l, c.c])) : undefined,
  };
}
