"use client";

import type { CSSProperties } from "react";
import { rsiZone, trendOf, type Technicals } from "@/lib/plugins/watchlist/technicals";
import type { Insight } from "@/lib/plugins/watchlist/insight";
import { priceText } from "./format";
import { Split, Tile } from "./insights";

/* Two more rows of tiles under the key figures, in the same block
   language. Signals: the RSI in its zone, the trend against the 50 and 200
   averages, the volatility (ATR as a share of the price), which side the
   MACD is on and since when — on the chart's interval. Pressure: where
   the nearest liquidation clusters would pull the price, the order book's
   balance, the last five minutes' flow. */

const ZONE = { oversold: "Oversold", neutral: "Neutral", overbought: "Overbought" } as const;
const TREND = { up: "Uptrend", down: "Downtrend", mixed: "Mixed" } as const;

export function Signals({ technicals, price, interval, message }: { technicals: Technicals | null; price: number | undefined; interval: string; message: string | null }) {
  if (!technicals && message) return <p className="wlv-insight-message">{message}</p>;
  const t = technicals ?? {};
  const trend = t.ema50 !== undefined && t.ema200 !== undefined && price !== undefined ? trendOf(price, t.ema50, t.ema200) : null;
  const vol = t.atr !== undefined && price ? (t.atr / price) * 100 : undefined;
  return (
    <div className="wlv-insights" style={{ "--cols": 4 } as CSSProperties} aria-busy={!technicals}>
      <Tile label="RSI 14" value={t.rsi === undefined ? "—" : `${t.rsi.toFixed(1)} · ${ZONE[rsiZone(t.rsi)]}`} tone={t.rsi === undefined ? undefined : rsiZone(t.rsi) === "oversold" ? "is-up" : rsiZone(t.rsi) === "overbought" ? "is-down" : undefined}>
        {t.rsi !== undefined && <Gauge value={t.rsi} />}
      </Tile>
      <Tile label="Trend" value={trend ? TREND[trend] : "—"} tone={trend === "up" ? "is-up" : trend === "down" ? "is-down" : undefined}>
        {t.ema50 !== undefined && t.ema200 !== undefined && <span className="wlv-insight-sub">EMA 50 {priceText(t.ema50)} · EMA 200 {priceText(t.ema200)}</span>}
      </Tile>
      <Tile label="Volatility" value={vol === undefined ? "—" : `${vol.toFixed(2)} %`}>
        {vol !== undefined && <span className="wlv-insight-sub">average range of a {interval} bar (ATR 14)</span>}
      </Tile>
      <Tile label="MACD" value={t.macd ? (t.macd.histogram >= 0 ? "Bullish" : "Bearish") : "—"} tone={t.macd ? (t.macd.histogram >= 0 ? "is-up" : "is-down") : undefined}>
        {t.macd && (
          <span className="wlv-insight-sub">
            for {t.macd.bars} bar{t.macd.bars > 1 ? "s" : ""}
            {t.macd.bars >= 30 ? " or more" : ""} · 12 / 26 / 9
          </span>
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

const PULL = { up: "Pulled up", down: "Pulled down", balanced: "Balanced" } as const;

export function Pressure({ insight, price }: { insight: Insight | null; price: number | undefined }) {
  const i = insight ?? {};
  const pull = pullOf(i);
  const level = (dist: number, sign: 1 | -1) => (price ? `${priceText(price * (1 + sign * dist))} (${sign > 0 ? "+" : "−"}${(dist * 100).toFixed(1)} %)` : `${sign > 0 ? "+" : "−"}${(dist * 100).toFixed(1)} %`);
  const bids = i.bookImbalance === undefined ? undefined : (1 + i.bookImbalance) / 2;
  return (
    <div className="wlv-insights" aria-busy={!insight}>
      <Tile label="Liquidation clusters" value={pull ? PULL[pull] : "—"} tone={pull === "up" ? "is-up" : pull === "down" ? "is-down" : undefined}>
        {(i.magnetUp || i.magnetDown) && (
          <span className="wlv-insight-sub wlv-levels">
            {i.magnetUp && <span>Above {level(i.magnetUp.dist, 1)}</span>}
            {i.magnetDown && <span>Below {level(i.magnetDown.dist, -1)}</span>}
          </span>
        )}
      </Tile>
      <Tile label="Order book" value={bids === undefined ? "—" : bids >= 0.5 ? `Bids ${Math.round(bids * 100)} %` : `Asks ${Math.round((1 - bids) * 100)} %`} tone={bids === undefined || Math.abs(bids - 0.5) < 0.05 ? undefined : bids > 0.5 ? "is-up" : "is-down"}>
        {bids !== undefined && <Split left={bids} leftLabel="bids" rightLabel="asks" />}
      </Tile>
      <Tile label="Flow · 5 min" value={i.flowBuyShare === undefined ? "—" : `${Math.round(i.flowBuyShare * 100)} % buying`} tone={i.flowBuyShare === undefined || Math.abs(i.flowBuyShare - 0.5) < 0.05 ? undefined : i.flowBuyShare > 0.5 ? "is-up" : "is-down"}>
        {i.flowBuyShare !== undefined && <Split left={i.flowBuyShare} leftLabel="buyers" rightLabel="sellers" />}
      </Tile>
    </div>
  );
}
