import { createHash } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { Holdings } from "./backfill";

export { holdingsOf } from "./backfill";

/* ---------------------------------------------------------------------------
   The portfolio read BEFORE it is asked for (user request, 2026-10-08: an
   account added, and the portfolio — tab, widget — must open with no wait).

   Two server caches, kept by the plugin (index.ts):
   - the accounts' read and prices (`summary`), one minute: the tab, the
     widget and an export asked at once share one read of the exchanges;
   - the history rebuilt from the ledgers (`backfill`), one hour: hundreds
     of exchange calls on a Bybit account — read once, served at once after.
   A job on the core's clock fills both as soon as the set of accounts
   changes (an account added, removed, its keys replaced) — and does
   nothing otherwise: no exchange call, no BytNode quota spent in the
   background for a portfolio already read. Pure, tested.
--------------------------------------------------------------------------- */

/** A promise per key for `ttl` ms: one load shared by every caller while
    it runs and after, a failure forgotten at once. */
export class Warm<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private ttl: number,
    private max = 8,
  ) {}

  get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttl) return hit.value;
    const entry = { at: now, value: load() };
    this.entries.set(key, entry);
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
    return entry.value;
  }

  has(key: string, now = Date.now()): boolean {
    const hit = this.entries.get(key);
    return !!hit && now - hit.at < this.ttl;
  }
}

/** The set of accounts and the price source, as one opaque key (a hash:
    the keys are never kept in clear in a map key). Order does not count. */
export function accountsKey(accounts: ExchangeAccount[], bytnodeKey: string): string {
  const parts = [...accounts].sort((a, b) => a.id.localeCompare(b.id)).map((a) => [a.id, a.exchange, a.apiKey, a.secret, a.password, a.testnet]);
  return createHash("sha256").update(JSON.stringify([parts, bytnodeKey])).digest("hex");
}

/** What a history depends on: the accounts and the ASSETS each holds — not
    their amounts, which move a little at every read (the history is kept
    an hour; an asset bought or sold out asks for a new one). */
export const holdingsKey = (holdings: Holdings): string =>
  holdings
    .map((h) => `${h.id}:${h.assets.map((a) => a.asset).sort().join(",")}`)
    .sort()
    .join("|");
