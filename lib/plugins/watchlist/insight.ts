import { orderCandles } from "../shared/candle";

/* ---------------------------------------------------------------------------
   What the Watchlist tab tells about the chosen asset under its chart,
   read from ONE `get_market_data` call (`CORE_FIELDS` + `PRESSURE_FIELDS`): the day's range
   and volume (24 hourly klines, whose `taker_buy` gives the buyers' share),
   the market cap (`tokenomics`), the funding (`funding_next`, a fraction
   per 8 h), the open interest (`oi_snapshots.oi_total`, in the ASSET's
   units — BytNode sums the venues' contracts, so it is priced here) with
   the longs' share (`ls_ratio@1h.part_long`), and the day's liquidations
   (`liq_cumulative`, 5-minute windows over 1 440 minutes). And where the
   price may be pulled, from the same call: the nearest liquidation
   clusters above and below (`heatmap`: fractional distance and
   `attraction` = density / distance²), the order book's imbalance
   (`orderbook.imbalance`, (bid − ask) / (bid + ask)) and the buyers' share
   of the last five minutes (`buysell_ratio.buy_ratio`). Every figure is
   optional: a pair BytNode covers only in part shows what there is.
   Pure, tested.
--------------------------------------------------------------------------- */

export const CORE_FIELDS = { klines_1h: 24, tokenomics: true, funding_next: true, oi_snapshots: true, ls_ratio: true, liq_cumulative: 1440 } as const;
/** The pull's fields: asked with the core ones, dropped if a pair refuses them. */
export const PRESSURE_FIELDS = { heatmap: true, orderbook: true, buysell_ratio: true } as const;

export type Insight = {
  range?: { low: number; high: number };
  volumeUsd?: number;
  /** The buyers' share of the day's volume, 0..1. */
  buyShare?: number;
  marketCap?: number;
  fdv?: number;
  /** Circulating over max (else total) supply, 0..1. */
  supplyShare?: number;
  /** In % per 8 h. */
  funding?: number;
  fundingApr?: number;
  fundingAt?: string;
  oiUsd?: number;
  /** The share of accounts long, 0..1. */
  longShare?: number;
  liqLongUsd?: number;
  liqShortUsd?: number;
  /** The nearest liquidation clusters: distance as a fraction of the
      price (0.012 = 1.2 %), and their pull. */
  magnetUp?: { dist: number; pull: number };
  magnetDown?: { dist: number; pull: number };
  /** (bid − ask) / (bid + ask), −1..1. */
  bookImbalance?: number;
  /** The buyers' share of the last five minutes, 0..1. */
  flowBuyShare?: number;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The value under `key`, wherever the response nests it. */
function under(v: unknown, key: string, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = under(x, key, depth + 1);
      if (f !== undefined) return f;
    }
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  if (key in v && v[key] !== null) return v[key];
  for (const x of Object.values(v)) {
    const f = under(x, key, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}

/** A field as one record: itself, or the latest row of a list. */
function latest(v: unknown): Record<string, unknown> | undefined {
  if (isRecord(v)) return v;
  if (!Array.isArray(v)) return undefined;
  const rows = v.filter(isRecord);
  if (!rows.length) return undefined;
  const t = (r: Record<string, unknown>) => Date.parse(String(r.timestamp ?? r.bucket ?? "")) || num(r.timestamp) || 0;
  return rows.reduce((a, b) => (t(b) > t(a) ? b : a));
}

export function readInsight(response: unknown, price: number | undefined): Insight {
  const out: Insight = {};

  const klines = under(response, "klines_1h");
  if (Array.isArray(klines)) {
    const bars = orderCandles(klines).slice(-24);
    if (bars.length) {
      out.range = { low: Math.min(...bars.map((b) => b.l)), high: Math.max(...bars.map((b) => b.h)) };
      out.volumeUsd = bars.reduce((s, b) => s + b.v * b.c, 0);
      const buy = klines.filter(isRecord).slice(-24).reduce((s, r) => s + (num(r.taker_buy) ?? 0), 0);
      const vol = bars.reduce((s, b) => s + b.v, 0);
      if (buy > 0 && vol > 0) out.buyShare = Math.min(1, buy / vol);
    }
  }

  const token = latest(under(response, "tokenomics"));
  if (token) {
    out.marketCap = num(token.market_cap);
    out.fdv = num(token.fdv);
    const circ = num(token.circulating_supply);
    const cap = num(token.max_supply) ?? num(token.total_supply);
    if (circ && cap) out.supplyShare = Math.min(1, circ / cap);
  }

  const funding = latest(under(response, "funding_next"));
  const rate = num(funding?.estimated_rate);
  if (rate !== undefined) {
    out.funding = rate * 100;
    out.fundingApr = num(funding?.apr);
    if (typeof funding?.settlement_at === "string") out.fundingAt = funding.settlement_at;
  }

  const oi = num(latest(under(response, "oi_snapshots"))?.oi_total);
  if (oi !== undefined && price) out.oiUsd = oi * price;

  const ls = latest(under(response, "ls_ratio@1h") ?? under(response, "ls_ratio"));
  const part = num(ls?.part_long);
  if (part !== undefined) out.longShare = part;

  const liq = under(response, "liq_cumulative");
  const liqRows = Array.isArray(liq) ? liq.filter(isRecord) : isRecord(liq) ? [liq] : [];
  if (liqRows.length) {
    out.liqLongUsd = liqRows.reduce((s, r) => s + (num(r.long_usd) ?? 0), 0);
    out.liqShortUsd = liqRows.reduce((s, r) => s + (num(r.short_usd) ?? 0), 0);
  }

  const heat = latest(under(response, "heatmap"));
  const du = num(heat?.dist_up);
  const dd = num(heat?.dist_down);
  if (du !== undefined && du > 0) out.magnetUp = { dist: du, pull: num(heat?.attraction_up) ?? 0 };
  if (dd !== undefined && dd > 0) out.magnetDown = { dist: dd, pull: num(heat?.attraction_down) ?? 0 };

  const imbalance = num(latest(under(response, "orderbook"))?.imbalance);
  if (imbalance !== undefined) out.bookImbalance = Math.max(-1, Math.min(1, imbalance));

  const buy = num(latest(under(response, "buysell_ratio"))?.buy_ratio);
  if (buy !== undefined) out.flowBuyShare = Math.max(0, Math.min(1, buy));
  return out;
}

/** A large amount, short: 1.24 B, 612.4 M, 48.2 K. */
export function compact(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const n = v / d;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2 })}${s ? ` ${s}` : ""}`;
}
