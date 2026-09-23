/* ---------------------------------------------------------------------------
   What the Watchlist's field proposes as the user types: the assets that
   can be followed with a price — BytNode's symbols, then the USDT / USDC
   pairs of the user's exchange accounts — or, with neither, well-known
   assets. Ranked: the ticker itself, a ticker that starts with what is
   typed, a name that does, then (from two letters) the ones that merely
   contain it. A typed
   pair that matches nothing is still offered as it is, last.
   Pure, tested.
--------------------------------------------------------------------------- */

export type Candidate = { symbol: string; base: string; name?: string; sources: string[] };

/** Well-known assets, for a user with no source yet (and for the names of
    an exchange's pairs, which come without one). */
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

export const knownCandidates = (): Candidate[] => KNOWN.map(([base, name]) => ({ symbol: `${base}/USDT`, base, name, sources: [] }));

/** One entry per pair: the sources of a pair listed twice are merged, the
    first name found is kept (else a well-known one). */
export function mergeCandidates(lists: Candidate[][]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const list of lists) {
    for (const c of list) {
      const had = by.get(c.symbol);
      if (had) {
        had.sources = [...new Set([...had.sources, ...c.sources])];
        had.name ??= c.name;
      } else by.set(c.symbol, { ...c, name: c.name ?? NAMES.get(c.base), sources: [...c.sources] });
    }
  }
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
  const hits = catalog
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r >= 0)
    /* Same rank: the better-known asset first (so an asset's pairs stay
       together), then a priced pair (BytNode before an exchange, USDT
       before other quotes), then the shorter ticker. */
    .sort((a, b) => a.r - b.r || fame(a.c) - fame(b.c) || score(b.c) - score(a.c) || a.c.base.length - b.c.base.length || a.c.symbol.localeCompare(b.c.symbol))
    .slice(0, limit)
    .map((x) => x.c);
  return hits;
}

const score = (c: Candidate) => (c.sources.includes("bytnode") ? 4 : c.sources.length ? 2 : 0) + (c.symbol.endsWith("/USDT") ? 1 : 0);
