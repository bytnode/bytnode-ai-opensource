"use client";

import type { ReactNode } from "react";
import { compact, type Insight } from "@/lib/plugins/watchlist/insight";
import { priceText } from "./format";

/* Under the chart, what else there is to know about the asset — six
   tiles of one block, like the calendar's grid (square inside, round only
   at the block's outer corners): the day's range with the price in it,
   the day's volume split buyers / sellers, the market cap, the funding,
   the open interest split longs / shorts, the day's liquidations split
   longs / shorts. A figure BytNode does not have for this pair reads "—";
   without a BytNode key the block says where the figures come from. */

type Props = { insight: Insight | null; price: number | undefined; message: string | null };

const usd = (v: number | undefined) => (v === undefined ? "—" : `$${compact(v)}`);
const share = (v: number) => `${Math.round(v * 100)} %`;

export function Insights({ insight, price, message }: Props) {
  if (!insight && message) return <p className="wlv-insight-message">{message}</p>;
  const i = insight ?? {};
  const liqTotal = i.liqLongUsd !== undefined || i.liqShortUsd !== undefined ? (i.liqLongUsd ?? 0) + (i.liqShortUsd ?? 0) : undefined;
  const at = i.fundingAt ? new Date(i.fundingAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="wlv-insights" aria-busy={!insight}>
      <Tile label="24 h range" value={i.range ? `${priceText(i.range.low)} – ${priceText(i.range.high)}` : "—"}>
        {i.range && price !== undefined && <Range low={i.range.low} high={i.range.high} at={price} />}
      </Tile>
      <Tile label="24 h volume" value={usd(i.volumeUsd)}>
        {i.buyShare !== undefined && <Split left={i.buyShare} leftLabel={`${share(i.buyShare)} buyers`} rightLabel="sellers" />}
      </Tile>
      <Tile label="Market cap" value={usd(i.marketCap)}>
        {(i.fdv !== undefined || i.supplyShare !== undefined) && (
          <span className="wlv-insight-sub">
            {i.fdv !== undefined && `FDV ${usd(i.fdv)}`}
            {i.fdv !== undefined && i.supplyShare !== undefined && " · "}
            {i.supplyShare !== undefined && `${share(i.supplyShare)} in circulation`}
          </span>
        )}
      </Tile>
      <Tile label="Funding" value={i.funding === undefined ? "—" : `${i.funding >= 0 ? "+" : "−"}${Math.abs(i.funding).toFixed(4)} %`} tone={i.funding === undefined || i.funding === 0 ? undefined : i.funding > 0 ? "is-up" : "is-down"}>
        {i.funding !== undefined && (
          <span className="wlv-insight-sub">
            per 8 h{i.fundingApr !== undefined && ` · APR ${i.fundingApr.toFixed(1)} %`}
            {at && ` · next ${at}`}
          </span>
        )}
      </Tile>
      <Tile label="Open interest" value={usd(i.oiUsd)}>
        {i.longShare !== undefined && <Split left={i.longShare} leftLabel={`${share(i.longShare)} long`} rightLabel="short" />}
      </Tile>
      <Tile label="24 h liquidations" value={usd(liqTotal)}>
        {liqTotal !== undefined && liqTotal > 0 && <Split left={(i.liqLongUsd ?? 0) / liqTotal} leftLabel={`Longs ${usd(i.liqLongUsd)}`} rightLabel={`Shorts ${usd(i.liqShortUsd)}`} invert />}
      </Tile>
    </div>
  );
}

export function Tile({ label, value, tone, children }: { label: string; value: string; tone?: "is-up" | "is-down"; children?: ReactNode }) {
  return (
    <div className="wlv-insight">
      <span className="wlv-insight-label">{label}</span>
      <span className={`wlv-insight-value${tone ? ` ${tone}` : ""}`}>{value}</span>
      {children}
    </div>
  );
}

/** Where the price sits in the day's range. */
function Range({ low, high, at }: { low: number; high: number; at: number }) {
  const f = high > low ? Math.max(0, Math.min(1, (at - low) / (high - low))) : 0.5;
  return (
    <span className="wlv-range" aria-label={`Price at ${Math.round(f * 100)} % of the day's range`}>
      <i style={{ left: `${f * 100}%` }} />
    </span>
  );
}

/** Two shares side by side: green then red — or, for the liquidations,
    the longs in red (they lost) and the shorts in green. */
export function Split({ left, leftLabel, rightLabel, invert = false }: { left: number; leftLabel: string; rightLabel: string; invert?: boolean }) {
  const l = Math.max(0, Math.min(1, left));
  return (
    <span className="wlv-split">
      <span className={`wlv-split-bar${invert ? " is-inverted" : ""}`} aria-hidden>
        <i style={{ flexGrow: l }} />
        <b style={{ flexGrow: 1 - l }} />
      </span>
      <span className="wlv-insight-sub wlv-split-labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </span>
    </span>
  );
}
