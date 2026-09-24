import type { Candle } from "../shared/candle";
import type { Snapshot, Summary } from "./aggregate";

/* ---------------------------------------------------------------------------
   The Portfolio tab's figures, from the plugin's data: the daily total as
   a series the chart can draw (one point a day, a missing day carrying the
   day before — the chart's time axis counts one bar per day), and the
   split by asset folded into a few shares and "Other".
   Pure, tested.
--------------------------------------------------------------------------- */

const DAY = 86_400_000;

/** The snapshots as daily bars (open = high = low = close = the total, in
    the chosen currency), gaps filled with the day before. */
export function dailySeries(points: Snapshot[], perUsd: number): Candle[] {
  const byDay = new Map(points.map((p) => [Date.parse(`${p.date}T00:00:00Z`), p.totalUsd * perUsd]));
  const days = [...byDay.keys()].filter(Number.isFinite).sort((a, b) => a - b);
  if (!days.length) return [];
  const out: Candle[] = [];
  let last = byDay.get(days[0]) ?? 0;
  for (let t = days[0]; t <= days[days.length - 1]; t += DAY) {
    last = byDay.get(t) ?? last;
    out.push({ t, o: last, h: last, l: last, c: last, v: 0 });
  }
  return out;
}

export type Slice = { asset: string; usd: number; share: number; amount?: number; count?: number };

/** The largest `max` assets, the rest as one "Other" slice (with how many
    it holds). */
export function allocation(assets: Summary["assets"], max = 7): Slice[] {
  if (assets.length <= max) return assets.map((a) => ({ asset: a.asset, usd: a.usd, share: a.share, amount: a.amount }));
  const head = assets.slice(0, max - 1).map((a) => ({ asset: a.asset, usd: a.usd, share: a.share, amount: a.amount }));
  const rest = assets.slice(max - 1);
  return [...head, { asset: "Other", usd: rest.reduce((s, a) => s + a.usd, 0), share: rest.reduce((s, a) => s + a.share, 0), count: rest.length }];
}
