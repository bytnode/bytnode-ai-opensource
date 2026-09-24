import type { Position } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { clientFor } from "@/lib/tools/exchange/client";
import { exchangeInfo } from "@/lib/tools/exchange/catalog";
import { describeExchangeError, withRetry } from "@/lib/tools/exchange/errors";
import { fundingRows, rowsOf, type Balances } from "@/lib/tools/exchange/balance";
import { bybitEarn } from "./bybit";
import { positionSize, type BalanceRow } from "@/lib/tools/exchange/format";
import { isQuote, quotes, type PriceSources } from "../shared/prices";
import { assetsToPrice, type AccountRead, type PriceBook } from "./aggregate";

/* ---------------------------------------------------------------------------
   Reading the accounts, for the consolidated portfolio — read-only calls
   only (balances, positions, tickers), the same the Exchange tools make.

   Spot and its funding wallet (and Bybit's Earn); futures unless the exchange has none, or a
   unified account whose futures balance IS the spot one (Bybit, OKX); the
   open positions. A failing call is recorded and the rest still reads.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

/** What a wallet holds: the total of each asset (free and locked). */
const held = (rows: BalanceRow[]) => rows.map((r) => ({ asset: r.asset, amount: r.total }));

const positionOf = (p: Position) => ({
  symbol: String(p.symbol),
  side: p.side ?? "?",
  size: positionSize(p),
  entry: p.entryPrice ?? null,
  mark: p.markPrice ?? null,
  pnl: p.unrealizedPnl ?? null,
  leverage: p.leverage ?? null,
  liquidation: p.liquidationPrice ?? null,
});

export async function readAccount(account: ExchangeAccount): Promise<AccountRead> {
  const read: AccountRead = { id: account.id, label: account.label, exchange: account.exchange, testnet: account.testnet, wallets: [], positions: [] };
  const problems: string[] = [];
  const info = exchangeInfo(account.exchange);
  try {
    /* A network hiccup (an exchange dropping a connection) is retried once. */
    const spot = await withRetry(() => clientFor(account, "spot"));
    read.wallets.push({ wallet: "spot", rows: held(rowsOf((await withRetry(() => spot.fetchBalance())) as Balances)) });
    const funding = await fundingRows(spot, account.exchange);
    if (funding?.length) read.wallets.push({ wallet: "funding", rows: held(funding) });
    /* Bybit's Earn savings: outside every balance ccxt reads. */
    if (account.exchange === "bybit") {
      const earn = await bybitEarn(spot);
      if (earn.length) read.wallets.push({ wallet: "earn", rows: earn });
    }
  } catch (e) {
    problems.push(`spot: ${describeExchangeError(e)}`);
  }
  if (info?.futures !== "none") {
    try {
      const futures = await withRetry(() => clientFor(account, "futures"));
      if (!info?.unified) read.wallets.push({ wallet: "futures", rows: held(rowsOf((await withRetry(() => futures.fetchBalance())) as Balances)) });
      if (futures.has["fetchPositions"]) read.positions = ((await withRetry(() => futures.fetchPositions())) as Position[]).filter((p) => (p.contracts ?? 0) > 0).map(positionOf);
    } catch (e) {
      problems.push(`futures: ${describeExchangeError(e)}`);
    }
  }
  if (problems.length) read.error = problems.join(" · ");
  return read;
}

export async function readAccounts(accounts: ExchangeAccount[]): Promise<AccountRead[]> {
  return Promise.all(accounts.map(readAccount));
}

/** The USD price of every non-stable asset held: BytNode, else the
    account's exchange. */
export async function priceBook(reads: AccountRead[], sources: PriceSources): Promise<PriceBook> {
  const assets = assetsToPrice(reads);
  const priced = await quotes(
    assets.map((a) => `${a}/USDT`),
    sources,
  );
  const book: PriceBook = {};
  for (const a of assets) {
    const q = priced.get(`${a}/USDT`);
    if (q && isQuote(q)) book[a] = q.price;
  }
  return book;
}
