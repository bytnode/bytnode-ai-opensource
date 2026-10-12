import { toSymbol } from "@/lib/tools/exchange/symbols";

/* ---------------------------------------------------------------------------
   A price, as the plugins use it: the last price of a pair, its changes
   over a few windows, where it comes from and when it was read.

   Pure: reading BytNode's `price_change` field wherever the response nests
   it, and the symbol forms (`BTC/USDT` for the user, `BTCUSDT` for
   BytNode). Tested.
--------------------------------------------------------------------------- */

export type Quote = {
  symbol: string;
  price: number;
  /** In %, when known. */
  change1h?: number;
  change4h?: number;
  change24h?: number;
  change7d?: number;
  /** `bytnode`, or the exchange's id. */
  source: string;
  /** ISO 8601. */
  at: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** `BTC/USDT` → `BTCUSDT` (BytNode's form). */
export const bytnodeSymbol = (symbol: string): string => symbol.replace("/", "").replace(/:.*$/, "").toUpperCase();

/** A symbol in its one form — `BTC/USDT` for "btc", "BTCUSDT", "btc-usdt":
    a bare asset is quoted in USDT, the market's reference — or null when
    it cannot be one. */
export function normalizeSymbol(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}([/-]?[A-Z0-9]{2,10})?(:[A-Z0-9]+)?$/.test(t)) return null;
  const pair = toSymbol(t.replace("-", "/"), "spot");
  return pair.includes("/") ? pair : `${pair}/USDT`;
}

/** The base asset of a pair: `BTC/USDT` → `BTC`. */
export const baseOf = (symbol: string): string => symbol.split("/")[0].toUpperCase();

/** BytNode's price change, found wherever the response puts it: the REST
    route's `{ time, price, changes_pct: { "1h", "4h", "1d", "1w", … } }`
    (the MCP's too), or the older `{ price, timestamp, changes }`. */
export function readPriceChange(response: unknown, symbol: string, now: Date): Quote | null {
  const found = find(response, (o) => num(o.price) !== undefined && (isRecord(o.changes_pct) || isRecord(o.changes)));
  if (!found) return null;
  const changes = (isRecord(found.changes_pct) ? found.changes_pct : found.changes) as Record<string, unknown>;
  const stamp = found.time ?? found.timestamp;
  const ts = num(stamp);
  const iso = typeof stamp === "string" && !Number.isFinite(Number(stamp)) ? Date.parse(stamp) : NaN;
  const at = Number.isFinite(iso) ? new Date(iso).toISOString() : ts ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : now.toISOString();
  return {
    symbol,
    price: num(found.price) as number,
    change1h: num(changes["1h"]),
    change4h: num(changes["4h"]),
    change24h: num(changes["1d"]),
    change7d: num(changes["1w"]),
    source: "bytnode",
    at,
  };
}

function find(v: unknown, test: (o: Record<string, unknown>) => boolean, depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = find(x, test, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (!isRecord(v)) return null;
  if (test(v)) return v;
  for (const x of Object.values(v)) {
    const r = find(x, test, depth + 1);
    if (r) return r;
  }
  return null;
}

/** BytNode's next funding rate for a pair, in % per 8 h: the REST route's
    `estimated_rate_pct` (already in %), or the older `estimated_rate` (a
    fraction). */
export function readFunding(response: unknown): number | undefined {
  const found = find(response, (o) => num(o.estimated_rate_pct) !== undefined || num(o.estimated_rate) !== undefined);
  if (!found) return undefined;
  const pct = num(found.estimated_rate_pct);
  if (pct !== undefined) return pct;
  const rate = num(found.estimated_rate);
  return rate === undefined ? undefined : rate * 100;
}
