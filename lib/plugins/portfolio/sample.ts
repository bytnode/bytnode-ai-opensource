import type { Snapshot, Summary } from "./aggregate";

/* ---------------------------------------------------------------------------
   Sample data for the Portfolio tab: four made-up accounts, a dozen
   assets, a few positions and a year of daily totals — to see the report
   filled before (or without) connecting a real account. The view says
   loudly that it is a sample; nothing here is ever written, sent or mixed
   with the user's own figures. Deterministic (a seeded walk), so the same
   day always draws the same sample.
   Pure, tested.
--------------------------------------------------------------------------- */

const PRICES: Record<string, number> = { BTC: 112_480, ETH: 4_312, SOL: 232.7, BNB: 1_012, XRP: 2.94, DOGE: 0.2643, LINK: 23.52, AVAX: 30.12, ADA: 0.84, HYPE: 55.83, USDT: 1, USDC: 1 };

const ACCOUNTS: Array<{ id: string; label: string; exchange: string; testnet: boolean; wallets: Record<"spot" | "futures" | "funding", Array<[string, number]>> }> = [
  {
    id: "sample-binance-main",
    label: "Binance — main",
    exchange: "binance",
    testnet: false,
    wallets: {
      spot: [["BTC", 0.42], ["ETH", 6.5], ["SOL", 48], ["BNB", 3.2], ["LINK", 210], ["USDT", 8_400]],
      futures: [["USDT", 6_200]],
      funding: [["USDC", 2_500]],
    },
  },
  {
    id: "sample-bybit-trading",
    label: "Bybit — trading",
    exchange: "bybit",
    testnet: false,
    wallets: {
      spot: [["BTC", 0.08], ["HYPE", 140], ["DOGE", 18_000], ["XRP", 2_400]],
      futures: [["USDT", 11_800]],
      funding: [["USDT", 1_200]],
    },
  },
  {
    id: "sample-kraken-long-term",
    label: "Kraken — long term",
    exchange: "kraken",
    testnet: false,
    wallets: {
      spot: [["BTC", 0.35], ["ETH", 4], ["ADA", 9_000], ["AVAX", 120], ["USDC", 3_000]],
      futures: [],
      funding: [],
    },
  },
  {
    id: "sample-binance-testnet",
    label: "Binance — testnet",
    exchange: "binance",
    testnet: true,
    wallets: { spot: [["USDT", 10_000]], futures: [["USDT", 5_000]], funding: [] },
  },
];

export function sampleSummary(): Summary {
  const whole = new Map<string, { amount: number; usd: number }>();
  const wallets = { spot: 0, futures: 0, funding: 0, earn: 0 };
  let totalUsd = 0;
  let testnetUsd = 0;
  const accounts: Summary["accounts"] = ACCOUNTS.map((a) => {
    const own = new Map<string, { amount: number; usd: number }>();
    const ownWallets = { spot: 0, futures: 0, funding: 0, earn: 0 };
    let usd = 0;
    for (const kind of ["spot", "futures", "funding"] as const) {
      for (const [asset, amount] of a.wallets[kind]) {
        const value = amount * PRICES[asset];
        usd += value;
        ownWallets[kind] += value;
        const o = own.get(asset) ?? { amount: 0, usd: 0 };
        own.set(asset, { amount: o.amount + amount, usd: o.usd + value });
        if (!a.testnet) {
          wallets[kind] += value;
          const w = whole.get(asset) ?? { amount: 0, usd: 0 };
          whole.set(asset, { amount: w.amount + amount, usd: w.usd + value });
        }
      }
    }
    if (a.testnet) testnetUsd += usd;
    else totalUsd += usd;
    return {
      id: a.id,
      label: a.label,
      exchange: a.exchange,
      testnet: a.testnet,
      usd,
      unpriced: 0,
      assets: [...own.entries()].map(([asset, x]) => ({ asset, amount: x.amount, usd: x.usd, share: usd > 0 ? x.usd / usd : 0 })).sort((x, y) => y.usd - x.usd),
      wallets: ownWallets,
    };
  });
  const positions: Summary["positions"] = [
    { label: "Bybit — trading", testnet: false, symbol: "BTC/USDT:USDT", side: "long", size: 0.12, entry: 106_900, mark: 112_480, pnl: 669.6, leverage: 5, liquidation: 86_300 },
    { label: "Bybit — trading", testnet: false, symbol: "SOL/USDT:USDT", side: "short", size: 60, entry: 226.4, mark: 232.7, pnl: -378, leverage: 3, liquidation: 298.1 },
    { label: "Binance — main", testnet: false, symbol: "ETH/USDT:USDT", side: "long", size: 2, entry: 4_180, mark: 4_312, pnl: 264, leverage: 2, liquidation: 2_150 },
    { label: "Binance — testnet", testnet: true, symbol: "HYPE/USDT:USDT", side: "short", size: 80, entry: 58.2, mark: 55.83, pnl: 189.6, leverage: 4, liquidation: 71.4 },
  ];
  return {
    totalUsd,
    testnetUsd,
    assets: [...whole.entries()].map(([asset, x]) => ({ asset, amount: x.amount, usd: x.usd, share: totalUsd > 0 ? x.usd / totalUsd : 0 })).sort((x, y) => y.usd - x.usd),
    wallets,
    accounts,
    unpriced: [{ label: "Kraken — long term", asset: "XYZ", amount: 1_500 }],
    positions,
    unrealizedPnl: positions.filter((p) => !p.testnet).reduce((s, p) => s + (p.pnl ?? 0), 0),
  };
}

/** A year of daily totals ending on `now` at today's total: a seeded walk
    with a drift, a correction in the spring and a recovery — and each live
    account's share of it, drifting on its own, ending on today's values
    and always adding up to the total. */
export function samplePoints(now: Date, days = 365): Snapshot[] {
  const summary = sampleSummary();
  const total = summary.totalUsd;
  let seed = 20260924;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const moves: number[] = [];
  for (let i = 0; i < days; i++) {
    const spring = i > 150 && i < 200 ? -0.006 : i >= 200 && i < 250 ? 0.004 : 0;
    moves.push(0.0012 + spring + (rnd() - 0.5) * 0.045);
  }
  /* Walked back from today, so the last point is today's total. */
  const values = [total];
  for (let i = moves.length - 1; i > 0; i--) values.unshift(values[0] / (1 + moves[i]));
  /* Each account's weight: today's share, bent by its own slow walk. */
  const live = summary.accounts.filter((a) => !a.testnet && a.id);
  const bends = live.map(() => {
    const walk = [0];
    for (let i = 1; i < values.length; i++) walk.push(walk[i - 1] + (rnd() - 0.5) * 0.03);
    const end = walk[walk.length - 1];
    return walk.map((w) => Math.exp(w - end));
  });
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return values.map((v, i) => {
    const d = new Date(today - (values.length - 1 - i) * 86_400_000);
    const raw = live.map((a, k) => (a.usd / total) * bends[k][i]);
    const sum = raw.reduce((s, x) => s + x, 0);
    const accounts = Object.fromEntries(live.map((a, k) => [a.id as string, Math.round(((v * raw[k]) / sum) * 100) / 100]));
    return { date: d.toISOString().slice(0, 10), at: d.toISOString(), totalUsd: Math.round(v * 100) / 100, assets: {}, accounts };
  });
}
