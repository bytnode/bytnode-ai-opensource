/* ---------------------------------------------------------------------------
   Margin arithmetic of a linear USDT perpetual, one-way mode.

   Liquidation happens when the margin left on the position falls to the
   maintenance margin, `mmr × price × size`:
     isolated — margin = entry × size / leverage;
     cross    — margin = the collateral backing the position.
   Solved for the price, this gives the formulas below. They leave out the
   exchanges' tier tables, fees and funding: the result is an ESTIMATE,
   always shown with its assumptions.

   Pure: the position calculator and the paper trading engine share it.
--------------------------------------------------------------------------- */

export type Side = "long" | "short";

/** The price at which an isolated position is liquidated. */
export function isolatedLiquidation(side: Side, entry: number, leverage: number, mmr: number): number {
  return side === "long" ? (entry * (1 - 1 / leverage)) / (1 - mmr) : (entry * (1 + 1 / leverage)) / (1 + mmr);
}

/** The price at which a cross position is liquidated, `collateral` being
    everything that backs it (a negative result: it cannot be liquidated). */
export function crossLiquidation(side: Side, entry: number, size: number, collateral: number, mmr: number): number {
  return side === "long" ? (entry * size - collateral) / (size * (1 - mmr)) : (entry * size + collateral) / (size * (1 + mmr));
}

/** The signed distance from a price to another, in % of the first. */
export const distancePct = (from: number, to: number): number => ((to - from) / from) * 100;
