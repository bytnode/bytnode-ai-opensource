"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { INTERVALS, type Candle, type Interval } from "@/lib/plugins/shared/candle";
import { WINDOWS, changeOf, heatOf, type Window } from "@/lib/plugins/watchlist/heat";
import { Pencil, Refresh, Trash } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { dateOf, moveOf, pairOf, pct, priceText, sourceName, timeOf, type Row } from "./format";
import { HeatMap } from "./heat-map";
import { Insights } from "./insights";
import { Pressure, Signals } from "./signals";
import { ComingUp } from "./coming-up";
import type { Technicals } from "@/lib/plugins/watchlist/technicals";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import type { Insight } from "@/lib/plugins/watchlist/insight";
import { PriceChart, type ChartMode } from "./price-chart";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";

/* The right sheet, top to bottom: the chosen asset's name in BytNode's
   ink and its note (edited in place); one row of figures — the price,
   live, and its move, then the four windows as one row of small tiles;
   the chart, of a modest height — a line like Stocks, candles on demand;
   under it, what else there is to know about the asset — key figures,
   technical signals, the pressure on the price, what is coming from the
   calendar — each a titled block of tiles; and, when the list has more
   than one asset, the heat map, in tiles of a fixed size. The state of the
   prices and the two actions sit discreetly in the corner, like the
   calendar's collection. */

type Props = {
  rows: Row[] | null;
  asset: Row | null;
  live: boolean;
  win: Window;
  interval: Interval;
  candles: Candle[] | null;
  chartMessage: string | null;
  insight: Insight | null;
  insightMessage: string | null;
  technicals: Technicals | null;
  technicalsMessage: string | null;
  /** The asset's coming events; null when the Calendar plugin is off. */
  coming: CalendarEvent[] | null;
  loading: boolean;
  problem: string | null;
  onWindow: (w: Window) => void;
  onInterval: (i: Interval) => void;
  onPick: (symbol: string) => void;
  onMenu: (e: MouseEvent<HTMLElement>, symbol: string) => void;
  onReload: () => void;
  onRemove: (symbol: string) => void;
  onNote: (symbol: string, note: string) => void;
};

export function Sheet({ rows, asset, live, win, interval, candles, chartMessage, insight, insightMessage, technicals, technicalsMessage, coming, loading, problem, onWindow, onInterval, onPick, onMenu, onReload, onRemove, onNote }: Props) {
  const m = useMessages();
  const t = m.watchlist.sheet;
  const [mode, setMode] = useState<ChartMode>("line");
  const modes: Array<{ value: ChartMode; label: string }> = [
    { value: "line", label: t.line },
    { value: "candles", label: t.candles },
  ];
  const at = asset?.quote?.at;
  const time = at ? new Date(at).toLocaleTimeString(dateTag()) : "";
  const status = loading ? m.common.loading : at ? (live ? t.live(time) : t.updated(time)) : rows ? t.noPriceYet : m.common.loading;
  const intervalLabel = INTERVALS.find((i) => i.value === interval)?.label ?? interval;

  return (
    <main className="wlv-pane wlv-sheet">
      <header className="wlv-head">
        {asset ? (
          <AssetTitle key={asset.symbol} asset={asset} onNote={onNote} />
        ) : (
          <div className="wlv-title-block">
            <h2 className="wlv-sheet-title">
              <span className="pv-ink">{rows ? t.emptyTitle : m.watchlist.title}</span>
            </h2>
            <p className="wlv-sheet-sub">{rows ? t.emptyHint : t.reading}</p>
          </div>
        )}
        <span className={`wlv-status${live ? " is-live" : ""}`}>{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} aria-label={t.readAgain} title={t.readAgain}>
          <Refresh />
        </button>
        {asset && (
          <button type="button" className="wlv-icon" onClick={() => onRemove(asset.symbol)} aria-label={t.removeLabel(asset.symbol)} title={t.removeTitle}>
            <Trash />
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}
      <div className="wlv-body">
        {asset && <Figures asset={asset} win={win} onWindow={onWindow} />}
        {asset && (
          <section className="wlv-chart-block" aria-label={t.chartLabel(asset.symbol)}>
            <div className="wlv-chart-bar">
              <Segmented label={t.interval} value={interval} options={INTERVALS} onChange={onInterval} />
              <Segmented label={t.chartStyle} value={mode} options={modes} onChange={setMode} />
            </div>
            <PriceChart candles={candles} interval={interval} mode={mode} message={chartMessage} />
          </section>
        )}
        {asset && (
          <>
            <Section title={t.keyFigures}>
              <Insights insight={insight} price={asset.quote?.price} message={insightMessage} />
            </Section>
            <Section title={t.signals} sub={t.onCandles(intervalLabel)}>
              <Signals technicals={technicals} price={asset.quote?.price} interval={intervalLabel} message={technicalsMessage} />
            </Section>
            {insight && (insight.magnetUp || insight.magnetDown || insight.bookImbalance !== undefined || insight.flowBuyShare !== undefined) && (
              <Section title={t.pressure} sub={t.pressureSub}>
                <Pressure insight={insight} price={asset.quote?.price} />
              </Section>
            )}
            {coming && (
              <Section title={t.comingUp} sub={t.fromCalendar}>
                <ComingUp events={coming} base={pairOf(asset.symbol)[0]} />
              </Section>
            )}
          </>
        )}
        {rows && rows.length > 1 && (
          <Section title={t.allAssets} sub={t.windowMove(m.watchlist.windows[win])}>
            <HeatMap rows={rows} win={win} selected={asset?.symbol ?? null} onPick={onPick} onMenu={onMenu} />
          </Section>
        )}
      </div>
    </main>
  );
}

/** A part of the sheet under the chart: its title in BytNode's ink. */
export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="wlv-section" aria-label={title}>
      <p className="wlv-section-title">
        <span className="pv-ink">{title}</span>
        {sub && <small>{sub}</small>}
      </p>
      {children}
    </section>
  );
}

/** The asset's name, and its note — a click edits it, Enter or leaving
    the field keeps it, Escape leaves it as it was. */
function AssetTitle({ asset, onNote }: { asset: Row; onNote: (symbol: string, note: string) => void }) {
  const m = useMessages();
  const t = m.watchlist.sheet;
  const [base, quote] = pairOf(asset.symbol);
  const [draft, setDraft] = useState<string | null>(null);
  const keep = () => {
    if (draft !== null && draft.trim() !== (asset.note ?? "")) onNote(asset.symbol, draft.trim());
    setDraft(null);
  };
  return (
    <div className="wlv-title-block">
      <h2 className="wlv-sheet-title">
        <span className="pv-ink">{base}</span>
        {quote && <span className="wlv-pair">/ {quote}</span>}
      </h2>
      {draft === null ? (
        <button type="button" className={`wlv-note${asset.note ? "" : " is-empty"}`} onClick={() => setDraft(asset.note ?? "")} title={t.editNote}>
          <span>{asset.note || t.addNote}</span>
          <Pencil />
        </button>
      ) : (
        <input
          className="wlv-input wlv-note-edit"
          aria-label={t.noteLabel(asset.symbol)}
          value={draft}
          placeholder={t.notePlaceholder}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={keep}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) keep();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      )}
    </div>
  );
}

/** One row: the price (a new one lights up, then settles), the move over the
    chosen window and where it comes from — then the four windows as one
    row of small tiles, the chosen one lit; a tile chooses its window. */
function Figures({ asset, win, onWindow }: { asset: Row; win: Window; onWindow: (w: Window) => void }) {
  const m = useMessages();
  const q = asset.quote;
  const [, quote] = pairOf(asset.symbol);
  const change = changeOf(q, win);
  const label = m.watchlist.windows[win];
  return (
    <div className="wlv-figures">
      <div className="wlv-hero">
        <p className="wlv-price">
          <span key={q?.price} className="wlv-price-value">
            {q ? priceText(q.price) : "—"}
          </span>
          {q && quote && <span className="wlv-price-unit">{quote}</span>}
          <span className={`wlv-move ${moveOf(change)}`}>
            {pct(change)}
            <small>{label}</small>
          </span>
        </p>
        <p className="wlv-source">{q ? m.watchlist.sheet.source(sourceName(q.source), timeOf(q.at), dateOf(asset.addedAt)) : (asset.error ?? m.watchlist.sheet.noPairPrice)}</p>
      </div>
      <div className="wlv-ladder" role="radiogroup" aria-label={m.watchlist.changeOver}>
        {WINDOWS.map((w) => {
          const c = changeOf(q, w.value);
          const heat = heatOf(c, w.value);
          return (
            <button key={w.value} type="button" role="radio" aria-checked={w.value === win} className={`wlv-rung ${moveOf(c)}${w.value === win ? " is-on" : ""}`} onClick={() => onWindow(w.value)}>
              <span className="wlv-rung-label">{m.watchlist.windows[w.value]}</span>
              <span className="wlv-rung-value">{pct(c)}</span>
              {/* The move on its window's scale, from the middle. */}
              <span className="wlv-rung-bar" aria-hidden>
                <i style={{ width: `${Math.abs(heat) * 50}%`, [heat < 0 ? "right" : "left"]: "50%" }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
