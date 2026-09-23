import { crossLiquidation, distancePct, isolatedLiquidation, type Side } from "../shared/margin";

/* ---------------------------------------------------------------------------
   The position calculator's arithmetic: how much to buy, where one would
   be liquidated, what is risked for what is aimed at.

   Every input is checked first: a stop on the wrong side of the entry, a
   risk larger than the capital, a target behind the entry are refused with
   the reason — a wrong size is worse than no size.

   Pure, tested against reference cases.
--------------------------------------------------------------------------- */

export type { Side };

type Refusal = { error: string };

const positive = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0;

/** The stop is on the losing side of the entry. */
function stopSide(side: Side, entry: number, stop: number): string | null {
  if (side === "long" && stop >= entry) return `For a long, the stop (${stop}) must be below the entry (${entry}).`;
  if (side === "short" && stop <= entry) return `For a short, the stop (${stop}) must be above the entry (${entry}).`;
  return null;
}

export type SizeInput = {
  capital: number;
  riskPercent?: number;
  riskAmount?: number;
  entry: number;
  stop: number;
  side: Side;
  /** Per side, as a fraction (0.0006 = 0.06 %). */
  feeRate?: number;
};

export type SizeResult = {
  /** In base asset. */
  size: number;
  /** In quote currency. */
  notional: number;
  /** Notional over capital. */
  leverage: number;
  riskAmount: number;
  stopDistancePct: number;
  /** Entry + exit fees, at the stop. */
  fees: number;
};

/** The size whose loss at the stop, fees included, is the risk. */
export function positionSize(i: SizeInput): SizeResult | Refusal {
  if (!positive(i.capital) || !positive(i.entry) || !positive(i.stop)) return { error: "Capital, entry and stop must be positive numbers." };
  if ((i.riskPercent === undefined) === (i.riskAmount === undefined)) return { error: "Give the risk either as `riskPercent` or as `riskAmount`, not both." };
  const risk = i.riskAmount ?? (i.capital * (i.riskPercent ?? 0)) / 100;
  if (!positive(risk)) return { error: "The risk must be positive." };
  if (risk > i.capital) return { error: `The risk (${risk}) is larger than the capital (${i.capital}).` };
  const side = stopSide(i.side, i.entry, i.stop);
  if (side) return { error: side };
  const fee = i.feeRate ?? 0;
  if (fee < 0 || fee > 0.01) return { error: "`feeRate` is a fraction per side, between 0 and 0.01 (1 %)." };
  const perUnit = Math.abs(i.entry - i.stop) + fee * (i.entry + i.stop);
  const size = risk / perUnit;
  const notional = size * i.entry;
  return {
    size,
    notional,
    leverage: notional / i.capital,
    riskAmount: risk,
    stopDistancePct: Math.abs(distancePct(i.entry, i.stop)),
    fees: size * fee * (i.entry + i.stop),
  };
}

export type LiquidationInput = {
  side: Side;
  entry: number;
  /** The maintenance margin rate, as a fraction. */
  mmr: number;
  mode: "isolated" | "cross";
  leverage?: number;
  /** Cross: the position size and the collateral backing it. */
  size?: number;
  collateral?: number;
};

export type LiquidationResult = { price: number; distancePct: number };

export function liquidation(i: LiquidationInput): LiquidationResult | Refusal {
  if (!positive(i.entry)) return { error: "The entry must be a positive number." };
  if (i.mmr < 0 || i.mmr >= 0.5) return { error: "The maintenance margin rate is a fraction below 0.5 (0.005 = 0.5 %)." };
  let price: number;
  if (i.mode === "isolated") {
    if (!positive(i.leverage) || (i.leverage ?? 0) < 1) return { error: "Isolated margin needs `leverage` (1 or more)." };
    price = isolatedLiquidation(i.side, i.entry, i.leverage as number, i.mmr);
  } else {
    if (!positive(i.size) || !positive(i.collateral)) return { error: "Cross margin needs the position `size` and the `collateral` backing it." };
    price = crossLiquidation(i.side, i.entry, i.size as number, i.collateral as number, i.mmr);
  }
  if (price <= 0) return { error: "No liquidation price: the collateral covers a fall to zero." };
  return { price, distancePct: distancePct(i.entry, price) };
}

export type RiskRewardInput = { side: Side; entry: number; stop: number; targets: number[]; feeRate?: number };

export type RiskRewardRow = { target: number; reward: number; ratio: number; breakevenWinRate: number };

/** For each target: the reward per unit over the risk per unit, fees
    included, and the win rate below which the trade loses money over time. */
export function riskReward(i: RiskRewardInput): { risk: number; rows: RiskRewardRow[] } | Refusal {
  if (!positive(i.entry) || !positive(i.stop)) return { error: "Entry and stop must be positive numbers." };
  const side = stopSide(i.side, i.entry, i.stop);
  if (side) return { error: side };
  if (i.targets.length === 0) return { error: "Give at least one target." };
  const fee = i.feeRate ?? 0;
  const risk = Math.abs(i.entry - i.stop) + fee * (i.entry + i.stop);
  const rows: RiskRewardRow[] = [];
  for (const target of i.targets) {
    if (!positive(target) || (i.side === "long" ? target <= i.entry : target >= i.entry)) {
      return { error: `The target ${target} is not on the winning side of the entry (${i.entry}) for a ${i.side}.` };
    }
    const reward = Math.abs(target - i.entry) - fee * (i.entry + target);
    const ratio = reward / risk;
    rows.push({ target, reward, ratio, breakevenWinRate: ratio > 0 ? 1 / (1 + ratio) : 1 });
  }
  return { risk, rows };
}
