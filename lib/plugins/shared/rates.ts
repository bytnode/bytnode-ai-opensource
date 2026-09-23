import ccxt, { type Exchange } from "ccxt";
import { CURRENCIES, fxPair, unitsPerUsd, type Currency } from "./fx";

/* ---------------------------------------------------------------------------
   Exchange rates, from Kraken's public market: no key, no account, read at
   most every ten minutes. SERVER-ONLY.
--------------------------------------------------------------------------- */

const TTL = 10 * 60_000;
let kraken: Promise<Exchange> | null = null;
let rates: { at: number; value: Record<Currency, number>; source: string } | null = null;

const market = () =>
  (kraken ??= (async () => {
    const ex = new ccxt.kraken({ enableRateLimit: true });
    await ex.loadMarkets();
    return ex;
  })().catch((e) => {
    kraken = null;
    throw e;
  }));

/** Units of each currency for one dollar, and when they were read. */
export async function usdRates(): Promise<{ value: Record<Currency, number>; at: string; source: string }> {
  if (rates && Date.now() - rates.at < TTL) return { value: rates.value, at: new Date(rates.at).toISOString(), source: rates.source };
  const ex = await market();
  const others = CURRENCIES.filter((c): c is Exclude<Currency, "USD"> => c !== "USD");
  const tickers = await ex.fetchTickers(others.map((c) => fxPair(c).pair));
  const value = { USD: 1 } as Record<Currency, number>;
  for (const c of others) {
    const last = tickers[fxPair(c).pair]?.last;
    if (typeof last !== "number" || last <= 0) throw new Error(`No ${fxPair(c).pair} rate on Kraken right now.`);
    value[c] = unitsPerUsd(c, last);
  }
  rates = { at: Date.now(), value, source: "Kraken" };
  return { value, at: new Date(rates.at).toISOString(), source: rates.source };
}
