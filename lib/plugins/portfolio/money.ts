import { isCurrency, type Currency } from "../shared/fx";
import { usdRates } from "../shared/rates";
import type { Money } from "./present";

/* The chosen currency and its rate. If the rate cannot be read, the
   figures stay in USD and say so — never a stale or invented rate.
   SERVER-ONLY. */
export async function moneyIn(wanted: unknown, fallback: unknown): Promise<Money> {
  const currency: Currency = isCurrency(wanted) ? wanted : isCurrency(fallback) ? fallback : "USD";
  if (currency === "USD") return { currency, perUsd: 1, rateNote: "" };
  try {
    const rates = await usdRates();
    return { currency, perUsd: rates.value[currency], rateNote: `1 USD = ${rates.value[currency].toPrecision(6)} ${currency}, ${rates.source} ${rates.at.slice(11, 16)} UTC` };
  } catch (e) {
    return { currency: "USD", perUsd: 1, rateNote: `${currency} rate unavailable (${e instanceof Error ? e.message : String(e)}): shown in USD` };
  }
}
