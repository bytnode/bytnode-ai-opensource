"use client";

import { useState } from "react";
import { INTERVALS, withTick, type Interval } from "@/lib/plugins/shared/candle";
import type { CandleSeries, Listed, Priced } from "@/lib/plugins/shared/prices";
import type { Settings } from "@/lib/domain/types";
import { Segmented } from "@/components/ui/segmented";
import { fmt } from "../bits";
import { usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { PriceChart } from "../watchlist/price-chart";
import { baseOf, pct, price, toneOf, type PaperState } from "./format";
import { useMessages } from "@/lib/i18n/react";

/* ---------------------------------------------------------------------------
   The market of the pair in the ticket, at the top of the sheet: its name,
   its price live and its 24 h move, its chart (BytNode's candles — a line
   like Stocks, read every minute, the live price moving the last bar), and
   what the chosen portfolio holds of it: the spot amount, a position, the
   orders waiting. Choosing a pair anywhere (the ticket, a row of the
   sheet) shows it here.
--------------------------------------------------------------------------- */

const CANDLES_MS = 60_000;
const BARS = 200;

type Props = { symbol: string; quote: Priced | null; pairs: Listed[] | null; data: PaperState | null; settings: Settings };

export function Market({ symbol, quote, pairs, data, settings }: Props) {
  const m = useMessages();
  const t = m.paperTrading.market;
  const [interval, setChartInterval] = useState<Interval>("1h");
  const series = usePluginData<CandleSeries>("paper-trading", "candles", settings, { symbol, interval, limit: BARS }, { keep: "exact" });
  useAwakeInterval(series.reload, CANDLES_MS);
  const current = series.data && series.data.symbol === symbol && series.data.interval === interval ? series.data : null;
  const live = quote && !("error" in quote) && quote.symbol === symbol ? quote : null;
  const bars = current && "candles" in current ? (live ? withTick(current.candles, live.price, Date.parse(live.at), interval) : current.candles) : null;
  const message = !symbol ? t.choosePair : current && "error" in current ? current.error : bars ? (bars.length ? null : m.paperTrading.noCandles) : (series.error ?? m.paperTrading.loadingChart);

  const base = baseOf(symbol);
  const name = pairs?.find((p) => p.symbol === symbol)?.name;
  const holding = data?.valuation.holdings.find((h) => h.asset === base);
  const position = data?.valuation.positions.find((p) => p.symbol === symbol);
  const waiting = data?.orders.filter((o) => o.symbol === symbol).length ?? 0;
  const here = [
    holding ? t.held(fmt(holding.amount), base) : "",
    position ? t.position(position.side, position.leverage, fmt(position.amount)) : "",
    waiting ? t.waiting(waiting) : "",
  ].filter(Boolean);

  return (
    <section className="ptv-market" aria-label={t.label(symbol)}>
      <div className="ptv-market-head">
        <div className="ptv-market-title">
          <p className="ptv-market-name">
            <b className="pv-ink">{base || "—"}</b>
            <span>{name ?? symbol}</span>
          </p>
          <p className="ptv-market-price">
            <span key={live?.price}>{live ? price(live.price) : "—"}</span>
            {live?.change24h !== undefined && (
              <b className={toneOf(live.change24h)}>
                {pct(live.change24h)}
                <small>24h</small>
              </b>
            )}
          </p>
          <p className="ptv-market-here">{here.length ? t.inPortfolio(here) : t.nothingHere}</p>
        </div>
        <Segmented label={m.paperTrading.interval} value={interval} options={INTERVALS} onChange={setChartInterval} />
      </div>
      <div className="ptv-market-chart">
        <PriceChart candles={bars} interval={interval} mode="line" message={message} />
      </div>
    </section>
  );
}
