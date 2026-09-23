/* ---------------------------------------------------------------------------
   Reference currencies: the five best-known and the Swiss franc.

   Values are computed in USD (stablecoins count as dollars) and shown in
   the currency the user chose. The rates come from Kraken's public market
   (no key: `rates.ts`) — an exchange, within "BytNode or the exchanges".
   CNY has no market there; AUD takes its place among the five.

   Pure: the pair to read for each currency, and the conversion. Tested.
--------------------------------------------------------------------------- */

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

/** The Kraken pair that prices this currency against the dollar, and
    whether its price must be inverted to get "units per USD". */
export function fxPair(currency: Exclude<Currency, "USD">): { pair: string; invert: boolean } {
  switch (currency) {
    case "EUR":
    case "GBP":
    case "AUD":
      return { pair: `${currency}/USD`, invert: true };
    default:
      return { pair: `USD/${currency}`, invert: false };
  }
}

/** Units of `currency` for one dollar, from the pair's last price. */
export const unitsPerUsd = (currency: Exclude<Currency, "USD">, last: number): number => (fxPair(currency).invert ? 1 / last : last);

export const fromUsd = (usd: number, unitsPerDollar: number): number => usd * unitsPerDollar;
