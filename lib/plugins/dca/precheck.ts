import type { Ticker } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";
import { n8 } from "@/lib/tools/exchange/format";

/* ---------------------------------------------------------------------------
   Before a real purchase is PROPOSED: is the pair listed and open, is the
   amount above the market's minimum, is there enough quote currency? A
   proposal the exchange would refuse is not put to the user — the failure
   is said instead, and the plan waits for its next due date. Read-only:
   nothing here places an order. SERVER-ONLY.
--------------------------------------------------------------------------- */

type MarketInfo = { active?: boolean; quote?: string; limits?: { amount?: { min?: number }; cost?: { min?: number } } };

/** Room for the fee and the price moving between check and confirmation. */
const MARGIN = 1.01;

export async function precheck(account: ExchangeAccount, symbol: string, quoteAmount: number): Promise<{ price: number } | { error: string }> {
  try {
    const ex = await clientFor(account, "spot");
    const market = ex.markets?.[symbol] as MarketInfo | undefined;
    if (!market) return { error: `${symbol} is not listed on ${account.label}.` };
    if (market.active === false) return { error: `${symbol} is not trading on ${account.label} right now.` };
    const quote = market.quote ?? symbol.split("/")[1];
    const price = ((await ex.fetchTicker(symbol)) as Ticker).last;
    if (!price) return { error: `No current price for ${symbol} on ${account.label}.` };
    const minCost = market.limits?.cost?.min;
    if (minCost !== undefined && quoteAmount < minCost) return { error: `${quoteAmount} ${quote} is below ${account.label}'s minimum order (${n8(minCost)} ${quote}).` };
    const minAmount = market.limits?.amount?.min;
    if (minAmount !== undefined && quoteAmount / price < minAmount) return { error: `${n8(quoteAmount / price)} is below ${account.label}'s minimum quantity for ${symbol} (${n8(minAmount)}).` };
    const balance = (await ex.fetchBalance()) as unknown as { free?: Record<string, number> };
    const free = balance.free?.[quote] ?? 0;
    if (free < quoteAmount * MARGIN) return { error: `Not enough ${quote} on ${account.label}: ${n8(free)} free, about ${n8(quoteAmount * MARGIN)} needed with the fee.` };
    return { price };
  } catch (e) {
    return { error: `${account.label}: ${describeExchangeError(e)}` };
  }
}
