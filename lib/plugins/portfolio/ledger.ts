import type { LedgerEntry } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import { clientFor } from "@/lib/tools/exchange/client";
import type { Move } from "./backfill";

/* ---------------------------------------------------------------------------
   An account's ledger — every change of a balance (trades, fees, deposits,
   withdrawals, transfers, funding) — read from its exchange through ccxt's
   `fetchLedger`, read-only. Bybit answers seven days per request (up to two
   years back), so the year is read week by week, each week paged. Binance's
   "ledger" in ccxt is the futures income only, not the wallets: it is not
   used (the view then keeps the estimate). Kept an hour per account: the
   past does not move. SERVER-ONLY.
--------------------------------------------------------------------------- */

const WEEK = 7 * 86_400_000;
const TTL = 60 * 60_000;
const cache = new Map<string, { at: number; moves: Move[] | null }>();

/** Why an exchange's ledger cannot rebuild the wallets. */
const NOT_WALLETS = new Set(["binance", "binanceusdm", "binancecoinm"]);

function toMove(e: LedgerEntry): Move | null {
  const t = e.timestamp;
  const asset = e.currency;
  if (typeof t !== "number" || !asset) return null;
  const delta = typeof e.before === "number" && typeof e.after === "number" ? e.after - e.before : typeof e.amount === "number" ? (e.direction === "out" ? -1 : 1) * Math.abs(e.amount) : undefined;
  return delta === undefined || !Number.isFinite(delta) || delta === 0 ? null : { t, asset: asset.toUpperCase(), delta };
}

/** The moves since `since`, or null when this exchange has no usable
    ledger (or it could not be read). */
export async function ledgerMoves(account: ExchangeAccount, since: number, now = Date.now()): Promise<Move[] | null> {
  const key = `${account.id}|${Math.floor(since / 86_400_000)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.moves;
  let moves: Move[] | null = null;
  try {
    const ex = await clientFor(account, "spot");
    if (ex.has["fetchLedger"] && !NOT_WALLETS.has(ex.id)) {
      const entries: LedgerEntry[] = [];
      if (ex.id === "bybit") {
        for (let start = since; start < now; start += WEEK) {
          const end = Math.min(start + WEEK - 1, now);
          entries.push(...((await ex.fetchLedger(undefined, start, 50, { endTime: end, paginate: true, paginationCalls: 40 })) as LedgerEntry[]));
        }
      } else {
        entries.push(...((await ex.fetchLedger(undefined, since, undefined, { paginate: true, paginationCalls: 100 })) as LedgerEntry[]));
      }
      /* Weeks can share an edge: one move per entry id. */
      const seen = new Set<string>();
      moves = entries.flatMap((e) => {
        const id = e.id ? String(e.id) : `${e.timestamp}|${e.currency}|${e.amount}|${e.after}`;
        if (seen.has(id)) return [];
        seen.add(id);
        const m = toMove(e);
        return m && m.t >= since ? [m] : [];
      });
    }
  } catch {
    moves = null;
  }
  cache.set(key, { at: now, moves });
  return moves;
}
