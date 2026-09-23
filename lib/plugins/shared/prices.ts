import type { Ticker } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { readBytnodeTool } from "@/lib/mcp/bytnode";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";
import { orderCandles, readKlines, type Candle, type Interval } from "./candle";
import { bytnodeSymbol, readFunding, readPriceChange, type Quote } from "./quote";

/* ---------------------------------------------------------------------------
   Prices for the plugins — BytNode first.

   A pair BytNode covers is read there (`get_market_data`, `price_change`):
   price and changes, dated. Otherwise, the exchange of one of the user's
   accounts that lists it (the price, the 24 h change). Never a price from
   memory: without a source, the answer is an error that says so. A few
   seconds of cache spare the same reading to a view and a tool asking
   together (a live view asks for less: `maxAge`). Candles come the same
   way: BytNode's klines, else an account's exchange. SERVER-ONLY.
--------------------------------------------------------------------------- */

export type PriceSources = { bytnodeKey?: string; accounts?: ExchangeAccount[]; signal?: AbortSignal };

export type Priced = Quote | { symbol: string; error: string };

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; value: Priced }>();

export const isQuote = (p: Priced): p is Quote => !("error" in p);

async function fromBytnode(symbol: string, key: string, signal: AbortSignal): Promise<Quote | null> {
  const res = await readBytnodeTool(key, "get_market_data", { symbol: bytnodeSymbol(symbol), price_change: true }, signal);
  if (!res.ok) return null;
  try {
    return readPriceChange(JSON.parse(res.text), symbol, new Date());
  } catch {
    return null;
  }
}

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

export async function quote(symbol: string, sources: PriceSources, maxAge = CACHE_MS): Promise<Priced> {
  const key = `${symbol}|${sources.bytnodeKey ? "b" : "-"}|${(sources.accounts ?? []).map((a) => a.id).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < Math.min(maxAge, CACHE_MS)) return hit.value;
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  let value: Priced | null = null;
  try {
    if (sources.bytnodeKey?.trim()) value = await fromBytnode(symbol, sources.bytnodeKey, signal);
    value ??= await fromExchange(symbol, sources.accounts ?? []);
  } catch (e) {
    value = { symbol, error: describeExchangeError(e) };
  }
  value ??= {
    symbol,
    error: sources.bytnodeKey?.trim() ? `No price for ${symbol}: BytNode does not cover it and no exchange account lists it.` : `No price for ${symbol}: no BytNode key, and no exchange account lists it.`,
  };
  cache.set(key, { at: Date.now(), value });
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

/** The funding rate of a perpetual, in % per 8 h: BytNode, else the
    exchange of an account. */
export async function fundingRate(symbol: string, sources: PriceSources): Promise<number | undefined> {
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  if (sources.bytnodeKey?.trim()) {
    const res = await readBytnodeTool(sources.bytnodeKey, "get_market_data", { symbol: bytnodeSymbol(symbol), funding_next: true }, signal);
    if (res.ok) {
      try {
        const rate = readFunding(JSON.parse(res.text));
        if (rate !== undefined) return rate;
      } catch {
        /* next source */
      }
    }
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

/** The last `limit` bars of a pair: BytNode's klines, else the exchange of
    an account that lists it. */
export async function candles(symbol: string, interval: Interval, limit: number, sources: PriceSources): Promise<CandleSeries> {
  const signal = sources.signal ?? AbortSignal.timeout(60_000);
  const n = Math.max(10, Math.min(1000, Math.round(limit)));
  let bytnodeError: string | null = null;
  try {
    if (sources.bytnodeKey?.trim()) {
      const key = `klines_${interval}`;
      const res = await readBytnodeTool(sources.bytnodeKey, "get_market_data", { symbol: bytnodeSymbol(symbol), [key]: n }, signal);
      if (res.ok) {
        /* An answer that does not parse is BytNode's problem, not an
           exchange's: the accounts are tried, then the error says so. */
        let bars: Candle[] = [];
        try {
          bars = readKlines(JSON.parse(res.text), key);
        } catch {
          bytnodeError = `BytNode's candles for ${symbol} could not be read.`;
        }
        if (bars.length) return { symbol, interval, candles: bars, source: "bytnode" };
      } else bytnodeError = res.message;
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
const listed = new Map<string, { at: number; value: Listed[] }>();

/** The pairs BytNode covers (`get_system_info`), with their names — the
    only assets the watchlist's field offers. Stablecoin pairs are left
    out. A few minutes of cache: the list barely moves. Empty without a
    key, or when BytNode cannot be read (and then not cached). */
export async function bytnodePairs(bytnodeKey: string | undefined, signal?: AbortSignal): Promise<Listed[]> {
  const key = bytnodeKey?.trim();
  if (!key) return [];
  const hit = listed.get(key);
  if (hit && Date.now() - hit.at < LISTED_MS) return hit.value;
  const res = await readBytnodeTool(key, "get_system_info", { include_status: false }, signal ?? AbortSignal.timeout(30_000));
  if (!res.ok) return [];
  try {
    const info = JSON.parse(res.text) as { symbols?: Array<{ symbol?: string; base_asset?: string; name?: string }> };
    const value = (info.symbols ?? []).flatMap((x) => {
      const base = (x.base_asset ?? "").toUpperCase();
      const quote = x.symbol?.toUpperCase().slice(base.length) ?? "";
      if (!base || !quote || base === "USDC" || base === "USDT") return [];
      return [{ symbol: `${base}/${quote}`, base, ...(x.name ? { name: x.name } : {}) }];
    });
    if (value.length) listed.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return [];
  }
}
