import { orderCandles } from "../shared/candle";
import { currentLocale, numberTag } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   What the Watchlist tab tells about the chosen asset under its chart,
   read from BytNode's REST API in two calls: ONE `/v1/snapshot`
   (`SNAPSHOT_FIELDS`) — the day's range and volume (24 hourly klines,
   whose `buy_volume_spot` gives the buyers' share of the spot volume), the
   market cap (`tokenomics`), the next funding (`funding_next`, in % per
   8 h), the open interest (`oi_history@1h`, `oi_total` in the ASSET's units
   — BytNode sums the venues' contracts, so it is priced here), where the
   price may be pulled (`heatmap_clusters`: the nearest liquidation
   clusters above and below, fractional distance and `attraction` =
   density / distance²), the order book's imbalance within ±1 %
   (`orderbook`, (bid − ask) / (bid + ask)) and the buyers' share of the
   last five minutes (`buysell_ratio.buy_ratio`) — and the day's
   liquidations (`/v1/liquidations/cumulative/history`, 5-minute buckets:
   each keeps its own 5-minute window, so the 288 of a day add up; the
   one-minute rows of a sliding window would count each liquidation five
   times). Every figure is optional: a pair BytNode covers only in part
   shows what there is. The longs' share is no longer served (BytNode
   retired its long/short ratio); it shows when an answer carries one.
   Pure, tested.
--------------------------------------------------------------------------- */

/** The `/v1/snapshot` query: each field and its depth. */
export const SNAPSHOT_FIELDS = { "klines@1h": 24, tokenomics: 1, funding_next: 1, "oi_history@1h": 1, heatmap_clusters: 1, orderbook: 1, buysell_ratio: 1 } as const;
/** The day's liquidations: 5-minute buckets over 24 h. */
export const LIQUIDATIONS = { timeframe: "5m", limit: 288 } as const;
/** Where the liquidations are put for `readInsight`, beside the snapshot's fields. */
export const LIQUIDATIONS_FIELD = "liquidations_cumulative@5m";

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
  const t = (r: Record<string, unknown>) => Date.parse(String(r.time ?? r.timestamp ?? r.bucket ?? "")) || num(r.timestamp) || 0;
  return rows.reduce((a, b) => (t(b) > t(a) ? b : a));
}

export function readInsight(response: unknown, price: number | undefined): Insight {
  const out: Insight = {};

  const klines = under(response, "klines@1h");
  if (Array.isArray(klines)) {
    const bars = orderCandles(klines).slice(-24);
    if (bars.length) {
      out.range = { low: Math.min(...bars.map((b) => b.l)), high: Math.max(...bars.map((b) => b.h)) };
      out.volumeUsd = bars.reduce((s, b) => s + b.v * b.c, 0);
      const rows = new Set(bars.map((b) => b.t));
      const day = klines.filter(isRecord).filter((r) => rows.has(Date.parse(String(r.time ?? ""))));
      const buy = day.reduce((s, r) => s + (num(r.buy_volume_spot) ?? 0), 0);
      const spot = day.reduce((s, r) => s + (num(r.volume_spot) ?? 0), 0);
      if (buy > 0 && spot > 0) out.buyShare = Math.min(1, buy / spot);
    }
  }

  const token = latest(under(response, "tokenomics"));
  if (token) {
    out.marketCap = num(token.market_cap_usd);
    out.fdv = num(token.fdv_usd);
    const circ = num(token.circulating_supply);
    const cap = num(token.max_supply) ?? num(token.total_supply);
    if (circ && cap) out.supplyShare = Math.min(1, circ / cap);
  }

  const funding = latest(under(response, "funding_next"));
  const rate = num(funding?.estimated_rate_pct);
  if (rate !== undefined) {
    out.funding = rate;
    out.fundingApr = num(funding?.apr_pct);
    if (typeof funding?.time === "string") out.fundingAt = funding.time;
  }

  const oi = num(latest(under(response, "oi_history@1h"))?.oi_total);
  if (oi !== undefined && price) out.oiUsd = oi * price;

  const part = num(latest(under(response, "ls_ratio@1h") ?? under(response, "ls_ratio"))?.part_long);
  if (part !== undefined) out.longShare = part;

  const liq = under(response, LIQUIDATIONS_FIELD);
  const liqRows = Array.isArray(liq) ? liq.filter(isRecord) : isRecord(liq) ? [liq] : [];
  if (liqRows.length) {
    out.liqLongUsd = liqRows.reduce((s, r) => s + (num(r.long_usd) ?? 0), 0);
    out.liqShortUsd = liqRows.reduce((s, r) => s + (num(r.short_usd) ?? 0), 0);
  }

  const heat = latest(under(response, "heatmap_clusters"));
  const du = num(heat?.dist_up);
  const dd = num(heat?.dist_down);
  if (du !== undefined && du > 0) out.magnetUp = { dist: du, pull: num(heat?.attraction_up) ?? 0 };
  if (dd !== undefined && dd > 0) out.magnetDown = { dist: dd, pull: num(heat?.attraction_down) ?? 0 };

  const book = latest(under(response, "orderbook"));
  const ranges = Array.isArray(book?.ranges) ? book.ranges.filter(isRecord) : [];
  /* The range closest to ±1 %: near enough to the price to matter. */
  const near = ranges.reduce<Record<string, unknown> | undefined>((a, r) => (!a || Math.abs((num(r.range_pct) ?? 99) - 1) < Math.abs((num(a.range_pct) ?? 99) - 1) ? r : a), undefined);
  const imbalance = num(near?.imbalance);
  if (imbalance !== undefined) out.bookImbalance = Math.max(-1, Math.min(1, imbalance));

  const buy = num(latest(under(response, "buysell_ratio"))?.buy_ratio);
  if (buy !== undefined) out.flowBuyShare = Math.max(0, Math.min(1, buy));
  return out;
}

/** The steps of a short amount, biggest first. Chinese counts by ten
    thousands (万) and hundred millions (亿), not by thousands. */
const WESTERN: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];
const CHINESE: Array<[number, string]> = [
  [1e12, "万亿"],
  [1e8, "亿"],
  [1e4, "万"],
];

/** A large amount, short, in the interface's language: 1.24 B, 612.4 M,
    48.2 K (12.4亿 in Chinese). */
export function compact(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const zh = currentLocale() === "zh";
  const [d, s] = (zh ? CHINESE : WESTERN).find(([step]) => a >= step) ?? [1, ""];
  const n = v / d;
  const text = n.toLocaleString(numberTag(), { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2 });
  return s ? `${text}${zh ? "" : " "}${s}` : text;
}
