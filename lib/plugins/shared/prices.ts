import type { Ticker } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { liveFeed, type Tick } from "@/lib/bytnode/live";
import { readingForAgent } from "@/lib/bytnode/reader";
import { restGet } from "@/lib/bytnode/rest";
import { readBytnodeTool } from "@/lib/mcp/bytnode";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";
import { orderCandles, readKlines, type Candle, type Interval } from "./candle";
import { bytnodeSymbol, readFunding, readPriceChange, type Quote } from "./quote";

/* ---------------------------------------------------------------------------
   Prices for the plugins — BytNode first, by the reader's road.

   Two readers (`lib/bytnode/reader.ts`):
     - the APP (a view, a widget, a background job): BytNode's REST API for
       what is at rest (candles, the funding, the pairs) and its WebSocket
       for the live price (`lib/bytnode/live.ts`, the last trade). The
       changes over a window are worked out live against a REST reading of
       `/v1/price-change` taken every `REFERENCE_MS`: the window's starting
       price is that reading's price over (1 + its change), and the live
       change is the live price against it. Without a live price (the
       connection refused, or not there yet), the REST reading itself;
     - an AI AGENT (a plugin's tool it called): BytNode's MCP tools, as its
       own reads (`get_market_data`, `get_system_info`).
   A pair BytNode does not cover is read on the exchange of one of the
   user's accounts that lists it (the price, the 24 h change; candles,
   funding the same way). Never a price from memory: without a source, the
   answer is an error that says so. SERVER-ONLY.
--------------------------------------------------------------------------- */

export type PriceSources = { bytnodeKey?: string; accounts?: ExchangeAccount[]; signal?: AbortSignal };

export type Priced = Quote | { symbol: string; error: string };

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; value: Priced }>();

export const isQuote = (p: Priced): p is Quote => !("error" in p);

const iso = (ms: number) => new Date(ms).toISOString();

/* --- the app's road: REST + WebSocket ----------------------------------- */

/** How old the REST reading the live changes are worked out against may be. */
export const REFERENCE_MS = 10 * 60_000;
/** A pair priced by the app stays streamed this long after its last use. */
export const LIVE_LEASE_MS = 3 * 60_000;
/** How long a first pricing waits for the pair's first live trade. */
const FIRST_TICK_MS = 2_500;
const FAILED_MS = 60_000;

type Reading = { at: number; value: Promise<Quote | { error: string }> };
const references = new Map<string, Reading>();

/** BytNode's `/v1/price-change` for a pair: its price and its changes, the
    reference of the live changes. Kept `REFERENCE_MS` (a failure, a
    minute). Shared by every caller, so no caller's signal cancels it (the
    request has its own timeout). */
export function referenceQuote(symbol: string, key: string): Promise<Quote | { error: string }> {
  const id = `${key}|${symbol}`;
  const hit = references.get(id);
  if (hit && Date.now() - hit.at < REFERENCE_MS) return hit.value;
  const at = Date.now();
  const value = restGet(key, "/v1/price-change", { symbol: bytnodeSymbol(symbol) }).then((res): Quote | { error: string } => {
    if (!res.ok) return { error: res.message };
    if (res.data === null || res.data === undefined) return { error: `BytNode has no price for ${symbol} right now.` };
    return readPriceChange(res.data, symbol, new Date()) ?? { error: `BytNode's price for ${symbol} could not be read.` };
  });
  references.set(id, { at, value });
  void value.then((v) => {
    /* A failure is not kept as long as a reading. */
    if ("error" in v && references.get(id)?.value === value) references.set(id, { at: at - REFERENCE_MS + FAILED_MS, value });
  });
  return value;
}

/** The changes of a REST reading carried to a live price. */
export function withLive(ref: Quote, tick: Tick): Quote {
  const move = (pct: number | undefined) => {
    if (pct === undefined || pct <= -100) return undefined;
    const start = ref.price / (1 + pct / 100);
    return start > 0 ? (tick.price / start - 1) * 100 : undefined;
  };
  return {
    symbol: ref.symbol,
    price: tick.price,
    change1h: move(ref.change1h),
    change4h: move(ref.change4h),
    change24h: move(ref.change24h),
    change7d: move(ref.change7d),
    source: "bytnode",
    at: iso(tick.at),
  };
}

/** The pairs BytNode covers, as `BTCUSDT` — null when the list cannot be
    read (every pair is then tried). */
export async function coveredSet(key: string, signal?: AbortSignal): Promise<Set<string> | null> {
  const listed = await bytnodePairs(key, signal);
  return listed.length ? new Set(listed.map((x) => bytnodeSymbol(x.symbol))) : null;
}

/** A pair, live: its last trade on the WebSocket with the changes worked
    out against the REST reading; that reading alone when there is no live
    price; null when BytNode does not cover the pair. */
async function appQuote(symbol: string, key: string, signal: AbortSignal): Promise<Quote | { error: string } | null> {
  const covered = await coveredSet(key, signal);
  const sym = bytnodeSymbol(symbol);
  if (covered && !covered.has(sym)) return null;
  const feed = liveFeed(key);
  feed.lease(sym, LIVE_LEASE_MS);
  const [ref, tick] = await Promise.all([referenceQuote(symbol, key), feed.last(sym) ?? feed.waitFor(sym, FIRST_TICK_MS)]);
  if (!("error" in ref)) return tick ? withLive(ref, tick) : ref;
  if (tick) return { symbol, price: tick.price, source: "bytnode", at: iso(tick.at) };
  return ref;
}

/* --- an agent's road: MCP ------------------------------------------------ */

async function agentQuote(symbol: string, key: string, signal: AbortSignal): Promise<Quote | { error: string } | null> {
  const res = await readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), price_change: true }, signal);
  /* A refused key or an unreachable BytNode is said as such; a pair
     BytNode does not cover goes on to the exchanges. */
  if (!res.ok) return /refused|unreachable|quota|rate limit/i.test(res.message) ? { error: res.message } : null;
  try {
    return readPriceChange(JSON.parse(res.text), symbol, new Date());
  } catch {
    return null;
  }
}

/* --- the exchanges ------------------------------------------------------- */

async function fromExchange(symbol: string, accounts: ExchangeAccount[]): Promise<Quote | null> {
  for (const account of accounts) {
    try {
      const ex = await clientFor(account, "spot");
      if (!ex.markets?.[symbol]) continue;
      const t = (await ex.fetchTicker(symbol)) as Ticker;
      if (typeof t.last !== "number") continue;
      return { symbol, price: t.last, change24h: t.percentage ?? undefined, source: ex.id, at: new Date(t.timestamp ?? Date.now()).toISOString() };
    } catch {
      /* next account */
    }
  }
  return null;
}

/** A pair's price. The app's reading is live (the WebSocket's last trade,
    `maxAge` does not apply); an agent's is kept a few seconds, so a view
    and a tool asking together read BytNode once. */
export async function quote(symbol: string, sources: PriceSources, maxAge = CACHE_MS): Promise<Priced> {
  const key = sources.bytnodeKey?.trim() ?? "";
  const agent = readingForAgent();
  const id = `${agent ? "agent" : "app"}|${symbol}|${key ? "b" : "-"}|${(sources.accounts ?? []).map((a) => a.id).join(",")}`;
  if (agent) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < Math.min(maxAge, CACHE_MS)) return hit.value;
  }
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  let value: Priced | null = null;
  let bytnodeError: string | null = null;
  try {
    if (key) {
      const r = agent ? await agentQuote(symbol, key, signal) : await appQuote(symbol, key, signal);
      if (r && "error" in r) bytnodeError = r.error;
      else value = r;
    }
    value ??= await fromExchange(symbol, sources.accounts ?? []);
  } catch (e) {
    value = { symbol, error: describeExchangeError(e) };
  }
  value ??= {
    symbol,
    error: bytnodeError ? bytnodeError : key ? `No price for ${symbol}: BytNode does not cover it and no exchange account lists it.` : `No price for ${symbol}: no BytNode key, and no exchange account lists it.`,
  };
  if (agent) cache.set(id, { at: Date.now(), value });
  return value;
}

/** Several pairs, four at a time. */
export async function quotes(symbols: string[], sources: PriceSources): Promise<Map<string, Priced>> {
  const out = new Map<string, Priced>();
  const queue = [...new Set(symbols)];
  const worker = async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) out.set(s, await quote(s, sources));
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return out;
}

const FUNDING_MS = 5 * 60_000;
const fundings = new Map<string, { at: number; value: Promise<number | undefined> }>();

/** BytNode's next funding forecast for a pair, by the reader's road. */
async function bytnodeFunding(symbol: string, key: string, signal: AbortSignal): Promise<number | undefined> {
  if (readingForAgent()) {
    const res = await readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), funding_next: true }, signal);
    if (!res.ok) return undefined;
    try {
      return readFunding(JSON.parse(res.text));
    } catch {
      return undefined;
    }
  }
  const id = `${key}|${symbol}`;
  const hit = fundings.get(id);
  if (hit && Date.now() - hit.at < FUNDING_MS) return hit.value;
  const value = restGet(key, "/v1/funding/next", { symbol: bytnodeSymbol(symbol) }).then((res) => (res.ok && res.data ? readFunding(res.data) : undefined));
  fundings.set(id, { at: Date.now(), value });
  void value.then((v) => {
    if (v === undefined && fundings.get(id)?.value === value) fundings.delete(id);
  });
  return value;
}

/** The funding rate of a perpetual, in % per 8 h: BytNode, else the
    exchange of an account. */
export async function fundingRate(symbol: string, sources: PriceSources): Promise<number | undefined> {
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  const key = sources.bytnodeKey?.trim();
  if (key) {
    const rate = await bytnodeFunding(symbol, key, signal);
    if (rate !== undefined) return rate;
  }
  for (const account of sources.accounts ?? []) {
    try {
      const ex = await clientFor(account, "futures");
      const perp = `${symbol}:${symbol.split("/")[1]}`;
      if (!ex.markets?.[perp] || !ex.has["fetchFundingRate"]) continue;
      const f = (await ex.fetchFundingRate(perp)) as { fundingRate?: number };
      if (typeof f.fundingRate === "number") return f.fundingRate * 100;
    } catch {
      /* next account */
    }
  }
  return undefined;
}

export type CandleSeries = { symbol: string; interval: Interval; candles: Candle[]; source: string } | { symbol: string; interval: Interval; error: string };

const CANDLES_MS = 15_000;
const series = new Map<string, { at: number; value: Promise<{ bars: Candle[] } | { error: string }> }>();

/** BytNode's last `n` bars of a pair, by the reader's road: `/v1/klines`
    (most recent first, put back in order) or the MCP's
    `get_market_data(klines, timeframe)`. */
function bytnodeCandles(symbol: string, interval: Interval, n: number, key: string, signal: AbortSignal): Promise<{ bars: Candle[] } | { error: string }> {
  if (readingForAgent()) {
    return readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), klines: n, timeframe: interval }, signal).then((res) => {
      if (!res.ok) return { error: res.message };
      try {
        return { bars: readKlines(JSON.parse(res.text), `klines@${interval}`) };
      } catch {
        return { error: `BytNode's candles for ${symbol} could not be read.` };
      }
    });
  }
  const id = `${key}|${symbol}|${interval}|${n}`;
  const hit = series.get(id);
  if (hit && Date.now() - hit.at < CANDLES_MS) return hit.value;
  const value = restGet(key, "/v1/klines", { symbol: bytnodeSymbol(symbol), timeframe: interval, limit: n }).then((res) => {
    if (!res.ok) return { error: res.message };
    return { bars: Array.isArray(res.data) ? orderCandles(res.data) : [] };
  });
  series.set(id, { at: Date.now(), value });
  void value.then((v) => {
    if ("error" in v && series.get(id)?.value === value) series.delete(id);
  });
  return value;
}

/** The last `limit` bars of a pair: BytNode's klines, else the exchange of
    an account that lists it. */
export async function candles(symbol: string, interval: Interval, limit: number, sources: PriceSources): Promise<CandleSeries> {
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  const n = Math.max(10, Math.min(1000, Math.round(limit)));
  let bytnodeError: string | null = null;
  try {
    const key = sources.bytnodeKey?.trim();
    if (key) {
      const res = await bytnodeCandles(symbol, interval, n, key, signal);
      if ("error" in res) bytnodeError = res.error;
      else if (res.bars.length) return { symbol, interval, candles: res.bars, source: "bytnode" };
    }
    for (const account of sources.accounts ?? []) {
      try {
        const ex = await clientFor(account, "spot");
        if (!ex.markets?.[symbol] || !ex.has["fetchOHLCV"]) continue;
        const rows = await ex.fetchOHLCV(symbol, interval, undefined, n);
        const bars = orderCandles(rows);
        if (bars.length) return { symbol, interval, candles: bars, source: ex.id };
      } catch {
        /* next account */
      }
    }
  } catch (e) {
    return { symbol, interval, error: describeExchangeError(e) };
  }
  if (bytnodeError) return { symbol, interval, error: bytnodeError };
  return { symbol, interval, error: sources.bytnodeKey?.trim() ? `No chart for ${symbol}: BytNode does not cover it and no exchange account lists it.` : `No chart for ${symbol}: no BytNode key, and no exchange account lists it.` };
}

export type Listed = { symbol: string; base: string; name?: string };

const LISTED_MS = 10 * 60_000;
const listed = new Map<string, { at: number; value: Promise<Listed[]> }>();

/** `[{symbol, base_asset, name}]` as the plugins list them: `BTC/USDT`,
    stablecoin pairs left out. */
function toListed(rows: unknown): Listed[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((x: { symbol?: string; base_asset?: string; name?: string }) => {
    const base = (x?.base_asset ?? "").toUpperCase();
    const quote = x?.symbol?.toUpperCase().slice(base.length) ?? "";
    if (!base || !quote || base === "USDC" || base === "USDT") return [];
    return [{ symbol: `${base}/${quote}`, base, ...(x.name ? { name: x.name } : {}) }];
  });
}

/** The pairs BytNode covers, with their names — the only assets the
    watchlist's field offers. Stablecoin pairs are left out. A few minutes
    of cache: the list barely moves. Empty without a key, or when BytNode
    cannot be read (and then not cached). The app reads `/v1/symbols`; an
    agent, `get_system_info`. */
export function bytnodePairs(bytnodeKey: string | undefined, signal?: AbortSignal): Promise<Listed[]> {
  const key = bytnodeKey?.trim();
  if (!key) return Promise.resolve([]);
  const agent = readingForAgent();
  const id = `${agent ? "agent" : "app"}|${key}`;
  const hit = listed.get(id);
  if (hit && Date.now() - hit.at < LISTED_MS) return hit.value;
  /* Shared by the callers of the moment: no caller's signal cancels it. */
  void signal;
  const value = (async (): Promise<Listed[]> => {
    if (agent) {
      const res = await readBytnodeTool(key, "get_system_info", { include_status: false }, AbortSignal.timeout(30_000));
      if (!res.ok) return [];
      try {
        return toListed((JSON.parse(res.text) as { symbols?: unknown }).symbols);
      } catch {
        return [];
      }
    }
    const res = await restGet(key, "/v1/symbols");
    return res.ok ? toListed(res.data) : [];
  })();
  listed.set(id, { at: Date.now(), value });
  /* An empty list (BytNode unreadable) is not kept. */
  void value.then((v) => {
    if (!v.length && listed.get(id)?.value === value) listed.delete(id);
  });
  return value;
}
