/* ---------------------------------------------------------------------------
   What the Watchlist's field proposes as the user types: BytNode's assets,
   and nothing else — one that BytNode does not cover cannot be added from
   the view. Ranked: the ticker itself, a ticker that starts with what is
   typed, a name that does, then (from two letters) the ones that merely
   contain it; nothing found is said as such.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Candidate = { symbol: string; base: string; name?: string };

/** Well-known assets: a name for a pair that comes without one, and the
    order of fame that ranks equal matches. */
export const KNOWN: Array<[string, string]> = [
  ["BTC", "Bitcoin"],
  ["ETH", "Ethereum"],
  ["SOL", "Solana"],
  ["XRP", "XRP"],
  ["BNB", "BNB"],
  ["DOGE", "Dogecoin"],
  ["ADA", "Cardano"],
  ["TRX", "TRON"],
  ["AVAX", "Avalanche"],
  ["LINK", "Chainlink"],
  ["DOT", "Polkadot"],
  ["TON", "Toncoin"],
  ["SUI", "Sui"],
  ["XLM", "Stellar"],
  ["LTC", "Litecoin"],
  ["BCH", "Bitcoin Cash"],
  ["HBAR", "Hedera"],
  ["NEAR", "NEAR Protocol"],
  ["UNI", "Uniswap"],
  ["APT", "Aptos"],
  ["ARB", "Arbitrum"],
  ["OP", "Optimism"],
  ["POL", "Polygon"],
  ["ATOM", "Cosmos"],
  ["XMR", "Monero"],
  ["HYPE", "Hyperliquid"],
  ["TAO", "Bittensor"],
  ["AAVE", "Aave"],
  ["PEPE", "Pepe"],
  ["SHIB", "Shiba Inu"],
  ["INJ", "Injective"],
  ["RENDER", "Render"],
  ["FIL", "Filecoin"],
  ["ENA", "Ethena"],
  ["WLD", "Worldcoin"],
];

const NAMES = new Map(KNOWN);
/** How well known an asset is: its place in `KNOWN` (roughly by size). */
const RANK = new Map(KNOWN.map(([base], i) => [base, i]));
const fame = (c: Candidate) => RANK.get(c.base) ?? KNOWN.length;
const usdt = (c: Candidate) => (c.symbol.endsWith("/USDT") ? 1 : 0);

/** BytNode's pairs, once each, each named (its own name, else a
    well-known one). */
export function named(pairs: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const c of pairs) if (!by.has(c.symbol)) by.set(c.symbol, { ...c, name: c.name ?? NAMES.get(c.base) });
  return [...by.values()];
}

/** What is typed, as a ticker: `eth`, `ETH/USDT`, `ethusdt` → `ETH`. */
export function queryBase(q: string): string {
  const t = q.trim().toUpperCase().replace(/[\s-]/g, "");
  const pair = t.split("/")[0];
  return pair.length > 4 && /(USDT|USDC)$/.test(pair) ? pair.replace(/(USDT|USDC)$/, "") : pair;
}

export function suggest(query: string, catalog: Candidate[], limit = 8): Candidate[] {
  const base = queryBase(query);
  const text = query.trim().toLowerCase();
  if (!base) return [];
  const rank = (c: Candidate): number => {
    const name = c.name?.toLowerCase() ?? "";
    if (c.base === base) return 0;
    if (c.base.startsWith(base)) return 1;
    if (name.startsWith(text)) return 2;
    /* One letter: only what starts with it — "contains" would list half the market. */
    if (base.length >= 2 && c.base.includes(base)) return 3;
    if (text.length >= 2 && name.includes(text)) return 4;
    return -1;
  };
  return (
    catalog
      .map((c) => ({ c, r: rank(c) }))
      .filter((x) => x.r >= 0)
      /* Same rank: the better-known asset first, USDT before another
         quote, then the shorter ticker. */
      .sort((a, b) => a.r - b.r || fame(a.c) - fame(b.c) || usdt(b.c) - usdt(a.c) || a.c.base.length - b.c.base.length || a.c.symbol.localeCompare(b.c.symbol))
      .slice(0, limit)
      .map((x) => x.c)
  );
}
