"use client";

import type { CSSProperties } from "react";
import { rsiZone, trendOf, type Technicals } from "@/lib/plugins/watchlist/technicals";
import type { Insight } from "@/lib/plugins/watchlist/insight";
import { fixed, priceText } from "./format";
import { Split, Tile } from "./insights";
import { useMessages } from "@/lib/i18n/react";

/* Two more rows of tiles under the key figures, in the same block
   language. Signals: the RSI in its zone, the trend against the 50 and 200
   averages, the volatility (ATR as a share of the price), which side the
   MACD is on and since when — on the chart's interval. Pressure: where
   the nearest liquidation clusters would pull the price, the order book's
   balance, the last five minutes' flow. */

export function Signals({ technicals, price, interval, message }: { technicals: Technicals | null; price: number | undefined; interval: string; message: string | null }) {
  const m = useMessages();
  const s = m.watchlist.signals;
  if (!technicals && message) return <p className="wlv-insight-message">{message}</p>;
  const t = technicals ?? {};
  const trend = t.ema50 !== undefined && t.ema200 !== undefined && price !== undefined ? trendOf(price, t.ema50, t.ema200) : null;
  const vol = t.atr !== undefined && price ? (t.atr / price) * 100 : undefined;
  return (
    <div className="wlv-insights" style={{ "--cols": 4 } as CSSProperties} aria-busy={!technicals}>
      <Tile label="RSI 14" value={t.rsi === undefined ? "—" : `${fixed(t.rsi, 1)} · ${s.zones[rsiZone(t.rsi)]}`} tone={t.rsi === undefined ? undefined : rsiZone(t.rsi) === "oversold" ? "is-up" : rsiZone(t.rsi) === "overbought" ? "is-down" : undefined}>
        {t.rsi !== undefined && <Gauge value={t.rsi} />}
      </Tile>
      <Tile label={s.trend} value={trend ? s.trends[trend] : "—"} tone={trend === "up" ? "is-up" : trend === "down" ? "is-down" : undefined}>
        {t.ema50 !== undefined && t.ema200 !== undefined && <span className="wlv-insight-sub">EMA 50 {priceText(t.ema50)} · EMA 200 {priceText(t.ema200)}</span>}
      </Tile>
      <Tile label={s.volatility} value={vol === undefined ? "—" : `${fixed(vol, 2)} %`}>
        {vol !== undefined && <span className="wlv-insight-sub">{s.volatilitySub(interval)}</span>}
      </Tile>
      <Tile label="MACD" value={t.macd ? (t.macd.histogram >= 0 ? s.bullish : s.bearish) : "—"} tone={t.macd ? (t.macd.histogram >= 0 ? "is-up" : "is-down") : undefined}>
        {t.macd && (
          <span className="wlv-insight-sub">{s.macdSub(t.macd.bars, t.macd.bars >= 30)}</span>
        )}
      </Tile>
    </div>
  );
}

/** The RSI on its 0–100 track, the 30 and 70 lines marked. */
function Gauge({ value }: { value: number }) {
  return (
    <span className="wlv-gauge" aria-hidden>
      <b style={{ left: "30%" }} />
      <b style={{ left: "70%" }} />
      <i style={{ left: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/** Which way the nearest clusters pull: a side wins by half again. */
function pullOf(i: Insight): "up" | "down" | "balanced" | null {
  if (!i.magnetUp && !i.magnetDown) return null;
  const up = i.magnetUp?.pull ?? 0;
  const down = i.magnetDown?.pull ?? 0;
  return up > down * 1.5 ? "up" : down > up * 1.5 ? "down" : "balanced";
}

export function Pressure({ insight, price }: { insight: Insight | null; price: number | undefined }) {
  const m = useMessages();
  const s = m.watchlist.signals;
  const i = insight ?? {};
  const pull = pullOf(i);
  const level = (dist: number, sign: 1 | -1) => (price ? `${priceText(price * (1 + sign * dist))} (${sign > 0 ? "+" : "−"}${fixed(dist * 100, 1)} %)` : `${sign > 0 ? "+" : "−"}${fixed(dist * 100, 1)} %`);
  const bids = i.bookImbalance === undefined ? undefined : (1 + i.bookImbalance) / 2;
  return (
    <div className="wlv-insights" aria-busy={!insight}>
      <Tile label={s.clusters} value={pull ? s.pulls[pull] : "—"} tone={pull === "up" ? "is-up" : pull === "down" ? "is-down" : undefined}>
        {(i.magnetUp || i.magnetDown) && (
          <span className="wlv-insight-sub wlv-levels">
            {i.magnetUp && <span>{s.above(level(i.magnetUp.dist, 1))}</span>}
            {i.magnetDown && <span>{s.below(level(i.magnetDown.dist, -1))}</span>}
          </span>
        )}
      </Tile>
      <Tile label={s.orderBook} value={bids === undefined ? "—" : bids >= 0.5 ? s.bidsShare(`${Math.round(bids * 100)} %`) : s.asksShare(`${Math.round((1 - bids) * 100)} %`)} tone={bids === undefined || Math.abs(bids - 0.5) < 0.05 ? undefined : bids > 0.5 ? "is-up" : "is-down"}>
        {bids !== undefined && <Split left={bids} leftLabel={s.bids} rightLabel={s.asks} />}
      </Tile>
      <Tile label={s.flow} value={i.flowBuyShare === undefined ? "—" : s.buying(`${Math.round(i.flowBuyShare * 100)} %`)} tone={i.flowBuyShare === undefined || Math.abs(i.flowBuyShare - 0.5) < 0.05 ? undefined : i.flowBuyShare > 0.5 ? "is-up" : "is-down"}>
        {i.flowBuyShare !== undefined && <Split left={i.flowBuyShare} leftLabel={s.buyers} rightLabel={s.sellers} />}
      </Tile>
    </div>
  );
}
