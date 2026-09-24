/* ---------------------------------------------------------------------------
   The consolidated portfolio: every account, every wallet, one figure.

   Values are in USD (a stablecoin is a dollar). An asset without a known
   price is listed apart — never counted as zero in silence. Testnet
   accounts are shown, never added to the total. An account that could not
   be read says why, and the others still count. Pure, tested.
--------------------------------------------------------------------------- */

export const STABLES = new Set(["USDT", "USDC", "USD", "FDUSD", "BUSD", "DAI", "TUSD", "USDE", "PYUSD"]);

export type Wallet = "spot" | "funding" | "futures";

export type PositionRead = {
  symbol: string;
  side: string;
  size: number;
  entry: number | null;
  mark: number | null;
  pnl: number | null;
  leverage: number | null;
  liquidation: number | null;
};

export type AccountRead = {
  label: string;
  exchange: string;
  testnet: boolean;
  wallets: Array<{ wallet: Wallet; rows: Array<{ asset: string; amount: number }> }>;
  positions: PositionRead[];
  /** What could not be read (the rest of the account still counts). */
  error?: string;
};

/** USD per unit, by asset. */
export type PriceBook = Record<string, number>;

/** USD per wallet kind. */
export type WalletSplit = Record<Wallet, number>;

export type Summary = {
  totalUsd: number;
  testnetUsd: number;
  assets: Array<{ asset: string; amount: number; usd: number; share: number }>;
  /** The live accounts' value per wallet kind. */
  wallets: WalletSplit;
  /** Each account on its own — its assets (largest first, shares of the
      account) and its wallets — for the view's per-account page. */
  accounts: Array<{ label: string; exchange: string; testnet: boolean; usd: number; unpriced: number; error?: string; assets: Array<{ asset: string; amount: number; usd: number; share: number }>; wallets: WalletSplit }>;
  unpriced: Array<{ label: string; asset: string; amount: number }>;
  positions: Array<PositionRead & { label: string; testnet: boolean }>;
  /** Unrealized PnL of the live accounts' positions, in USD(T). */
  unrealizedPnl: number;
};

export const priceOf = (asset: string, prices: PriceBook): number | undefined => (STABLES.has(asset) ? 1 : prices[asset]);

export function summarize(reads: AccountRead[], prices: PriceBook): Summary {
  const assets = new Map<string, { amount: number; usd: number }>();
  const accounts: Summary["accounts"] = [];
  const unpriced: Summary["unpriced"] = [];
  const positions: Summary["positions"] = [];
  let totalUsd = 0;
  let testnetUsd = 0;
  let unrealizedPnl = 0;
  const wallets: WalletSplit = { spot: 0, funding: 0, futures: 0 };
  for (const read of reads) {
    let usd = 0;
    let missing = 0;
    const own = new Map<string, { amount: number; usd: number }>();
    const ownWallets: WalletSplit = { spot: 0, funding: 0, futures: 0 };
    for (const { wallet, rows } of read.wallets) {
      for (const { asset, amount } of rows) {
        if (!(amount > 0)) continue;
        const price = priceOf(asset, prices);
        if (price === undefined) {
          missing++;
          unpriced.push({ label: read.label, asset, amount });
          continue;
        }
        const value = amount * price;
        usd += value;
        ownWallets[wallet] += value;
        if (!read.testnet) wallets[wallet] += value;
        const o = own.get(asset) ?? { amount: 0, usd: 0 };
        own.set(asset, { amount: o.amount + amount, usd: o.usd + value });
        if (!read.testnet) {
          const a = assets.get(asset) ?? { amount: 0, usd: 0 };
          assets.set(asset, { amount: a.amount + amount, usd: a.usd + value });
        }
      }
    }
    for (const p of read.positions) {
      positions.push({ ...p, label: read.label, testnet: read.testnet });
      if (!read.testnet && typeof p.pnl === "number") unrealizedPnl += p.pnl;
    }
    if (read.testnet) testnetUsd += usd;
    else totalUsd += usd;
    accounts.push({
      label: read.label,
      exchange: read.exchange,
      testnet: read.testnet,
      usd,
      unpriced: missing,
      ...(read.error ? { error: read.error } : {}),
      assets: [...own.entries()].map(([asset, a]) => ({ asset, amount: a.amount, usd: a.usd, share: usd > 0 ? a.usd / usd : 0 })).sort((a, b) => b.usd - a.usd),
      wallets: ownWallets,
    });
  }
  return {
    totalUsd,
    testnetUsd,
    assets: [...assets.entries()]
      .map(([asset, a]) => ({ asset, amount: a.amount, usd: a.usd, share: totalUsd > 0 ? a.usd / totalUsd : 0 }))
      .sort((a, b) => b.usd - a.usd),
    wallets,
    accounts,
    unpriced,
    positions,
    unrealizedPnl,
  };
}

/** The assets to price: every non-stable asset held. */
export const assetsToPrice = (reads: AccountRead[]): string[] => [...new Set(reads.flatMap((r) => r.wallets.flatMap((w) => w.rows.map((x) => x.asset)))).values()].filter((a) => !STABLES.has(a));

/* --- Snapshots ---------------------------------------------------------- */

/** One a day: the total and the split by asset, in USD — no key, no
    account name. */
export type Snapshot = { date: string; at: string; totalUsd: number; assets: Record<string, number> };

export function snapshotOf(summary: Summary, now: Date): Snapshot {
  return { date: now.toISOString().slice(0, 10), at: now.toISOString(), totalUsd: summary.totalUsd, assets: Object.fromEntries(summary.assets.map((a) => [a.asset, a.usd])) };
}

/** The journal read back: one snapshot per day (the last one of the day),
    in date order, within `days` of `now`. */
export function history(lines: Snapshot[], days: number, now: Date): Snapshot[] {
  const byDate = new Map<string, Snapshot>();
  for (const s of lines) if (typeof s?.date === "string" && typeof s.totalUsd === "number") byDate.set(s.date, s);
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return [...byDate.values()].filter((s) => s.date >= from).sort((a, b) => a.date.localeCompare(b.date));
}

/** From the first to the last point: the change, in USD and in %. */
export function change(points: Snapshot[]): { usd: number; pct: number } | null {
  if (points.length < 2) return null;
  const first = points[0].totalUsd;
  const last = points[points.length - 1].totalUsd;
  return { usd: last - first, pct: first > 0 ? ((last - first) / first) * 100 : 0 };
}
