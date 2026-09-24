import type { Candle } from "../shared/candle";
import { STABLES, type Snapshot } from "./aggregate";

/* ---------------------------------------------------------------------------
   The history before the snapshots: what today's holdings were worth each
   day of the past — each asset's amount times that day's close (a
   stablecoin at one dollar) — per account and in all. An ESTIMATE: it
   knows nothing of past trades, deposits or withdrawals, and the view
   says so; a real daily snapshot always wins over it for its day.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Holdings = Array<{ id: string; assets: Array<{ asset: string; amount: number }> }>;

export type Estimated = Snapshot & { estimated: true };

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The non-stable assets to find a history for. */
export const assetsOf = (holdings: Holdings): string[] => [...new Set(holdings.flatMap((h) => h.assets.map((a) => a.asset)))].filter((a) => !STABLES.has(a));

/** The estimated days, oldest first, over the days every priced asset has
    a close for (an asset without history is left out — `missing`). */
export function estimateHistory(holdings: Holdings, closes: Record<string, Candle[]>): { points: Estimated[]; missing: string[] } {
  const missing = assetsOf(holdings).filter((a) => !closes[a]?.length);
  const byAsset = new Map(
    Object.entries(closes)
      .filter(([, c]) => c.length)
      .map(([asset, c]) => [asset, new Map(c.map((b) => [dayOf(b.t), b.c]))]),
  );
  /* The days: those of the priced assets' histories, the shortest bounding. */
  const series = [...byAsset.values()];
  if (!series.length && !holdings.some((h) => h.assets.some((a) => STABLES.has(a.asset)))) return { points: [], missing };
  const days = series.length ? [...series[0].keys()].filter((d) => series.every((m) => m.has(d))).sort() : [];
  const points = days.map((date) => {
    const accounts: Record<string, number> = {};
    let total = 0;
    for (const h of holdings) {
      let usd = 0;
      for (const { asset, amount } of h.assets) {
        const price = STABLES.has(asset) ? 1 : byAsset.get(asset)?.get(date);
        if (price !== undefined && amount > 0) usd += amount * price;
      }
      accounts[h.id] = Math.round(usd * 100) / 100;
      total += usd;
    }
    return { date, at: `${date}T00:00:00.000Z`, totalUsd: Math.round(total * 100) / 100, assets: {}, accounts, estimated: true as const };
  });
  return { points, missing };
}

/** The history the view draws: the estimate, and every real snapshot in
    place of its day. */
export function mergeHistory(real: Snapshot[], estimated: Snapshot[]): Snapshot[] {
  const byDay = new Map(estimated.map((p) => [p.date, p]));
  for (const p of real) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
