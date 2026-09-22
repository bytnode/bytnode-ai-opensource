import ccxt, { type Exchange } from "ccxt";
import { createHash } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import { pemSecret } from "./accounts";
import { ccxtIdFor } from "./catalog";
import type { Market } from "./symbols";

/* ---------------------------------------------------------------------------
   One ccxt instance per account and per market, kept in memory.

   ⚠️ SERVER ONLY. `loadMarkets` costs one request and one second: we do
   it once per instance. The cache is keyed by a fingerprint of the key,
   never by the key itself. No withdrawal method is exposed by the tools;
   this module only opens the connection.
--------------------------------------------------------------------------- */

const cache = new Map<string, Promise<Exchange>>();
/** When each client's clock skew was last measured. */
const synced = new Map<string, number>();
/** Past this, we measure again: the PC clock drifts, and Bybit or Binance
    refuse a request dated more than one second AFTER their time. */
const RESYNC_MS = 10 * 60_000;

const fingerprint = (a: ExchangeAccount, market: Market) =>
  createHash("sha256").update(`${a.exchange}|${a.apiKey}|${a.secret}|${a.password}|${a.testnet}|${market}`).digest("hex");

export async function clientFor(account: ExchangeAccount, market: Market): Promise<Exchange> {
  const key = fingerprint(account, market);
  let hit = cache.get(key);
  if (!hit) {
    hit = open(account, market).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, hit);
  }
  const ex = await hit;
  if (Date.now() - (synced.get(key) ?? 0) > RESYNC_MS) {
    synced.set(key, Date.now());
    await syncClock(ex);
  }
  return ex;
}

/** Measures the gap between the PC clock and the exchange's; ccxt then
    dates every request at the exchange's time (`nonce()`). Silent if the
    exchange does not publish its time. */
async function syncClock(ex: Exchange): Promise<void> {
  if (!ex.has["fetchTime"]) return;
  try {
    await ex.loadTimeDifference();
  } catch {
    /* we keep the last measurement */
  }
}

type Ctor = new (config: Record<string, unknown>) => Exchange;

async function open(account: ExchangeAccount, market: Market): Promise<Exchange> {
  /* The class follows the market: KuCoin serves its futures through another
     class (same keys, other host). Only the ids ccxt publishes: never an
     arbitrary property of the object (`constructor`, `Exchange`…). */
  const id = ccxtIdFor(account.exchange, market);
  if (!ccxt.exchanges.includes(id)) throw Object.assign(new Error(`Exchange unknown to ccxt: ${id}`), { name: "NotSupported" });
  const Klass = (ccxt as unknown as Record<string, Ctor>)[id];
  const ex = new Klass({
    apiKey: account.apiKey,
    secret: pemSecret(account.secret),
    ...(account.password ? { password: account.password } : {}),
    enableRateLimit: true,
    options: {
      defaultType: market === "futures" ? "swap" : "spot",
      /* A PC clock drifts by a few seconds. Binance and Bybit require
         `timestamp < server_time + 1 s`: being one second ahead is enough
         to refuse everything (10002, -1021), and the window cannot help —
         only compensation counts. ccxt then dates the requests at the
         exchange's time; the window covers the rest. */
      adjustForTimeDifference: true,
      recvWindow: 10_000,
    },
  });
  if (account.testnet) ex.setSandboxMode(true);
  /* ⚠️ THE CLOCK SKEW BEFORE `loadMarkets`. Bybit queries the account
     (`query-api`) BEFORE `fetchMarkets` measures the gap: that call went
     out at the PC's time and hit 10002. */
  await syncClock(ex);
  await ex.loadMarkets();
  return ex;
}
