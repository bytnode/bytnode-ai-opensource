"use client";

import { useState, type ReactNode } from "react";
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
  onReload: () => void;
  onRemove: (symbol: string) => void;
  onNote: (symbol: string, note: string) => void;
};

const MODES: Array<{ value: ChartMode; label: string }> = [
  { value: "line", label: "Line" },
  { value: "candles", label: "Candles" },
];

export function Sheet({ rows, asset, live, win, interval, candles, chartMessage, insight, insightMessage, technicals, technicalsMessage, coming, loading, problem, onWindow, onInterval, onPick, onReload, onRemove, onNote }: Props) {
  const [mode, setMode] = useState<ChartMode>("line");
  const at = asset?.quote?.at;
  const status = loading ? "Loading…" : at ? `${live ? "Live" : "Updated"} ${new Date(at).toLocaleTimeString("en-GB")}` : rows ? "No price yet" : "Loading…";

  return (
    <main className="wlv-pane wlv-sheet">
      <header className="wlv-head">
        {asset ? (
          <AssetTitle key={asset.symbol} asset={asset} onNote={onNote} />
        ) : (
          <div className="wlv-title-block">
            <h2 className="wlv-sheet-title">
              <span className="pv-ink">{rows ? "Nothing followed yet" : "Watchlist"}</span>
            </h2>
            <p className="wlv-sheet-sub">{rows ? "Add an asset on the left, or ask an agent: “add BTC and ETH to my watchlist”." : "Reading your assets…"}</p>
          </div>
        )}
        <span className={`wlv-status${live ? " is-live" : ""}`}>{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} aria-label="Read the prices again" title="Read the prices again">
          <Refresh />
        </button>
        {asset && (
          <button type="button" className="wlv-icon" onClick={() => onRemove(asset.symbol)} aria-label={`Remove ${asset.symbol}`} title="Remove from the watchlist">
            <Trash />
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}
      <div className="wlv-body">
        {asset && <Figures asset={asset} win={win} onWindow={onWindow} />}
        {asset && (
          <section className="wlv-chart-block" aria-label={`${asset.symbol} chart`}>
            <div className="wlv-chart-bar">
              <Segmented label="Interval" value={interval} options={INTERVALS} onChange={onInterval} />
              <Segmented label="Chart style" value={mode} options={MODES} onChange={setMode} />
            </div>
            <PriceChart candles={candles} interval={interval} mode={mode} message={chartMessage} />
          </section>
        )}
        {asset && (
          <>
            <Section title="Key figures">
              <Insights insight={insight} price={asset.quote?.price} message={insightMessage} />
            </Section>
            <Section title="Signals" sub={`on ${INTERVALS.find((i) => i.value === interval)?.label ?? interval} candles`}>
              <Signals technicals={technicals} price={asset.quote?.price} interval={INTERVALS.find((i) => i.value === interval)?.label ?? interval} message={technicalsMessage} />
            </Section>
            {insight && (insight.magnetUp || insight.magnetDown || insight.bookImbalance !== undefined || insight.flowBuyShare !== undefined) && (
              <Section title="Pressure" sub="where the price may be pulled">
                <Pressure insight={insight} price={asset.quote?.price} />
              </Section>
            )}
            {coming && (
              <Section title="Coming up" sub="from the calendar">
                <ComingUp events={coming} base={pairOf(asset.symbol)[0]} />
              </Section>
            )}
          </>
        )}
        {rows && rows.length > 1 && (
          <Section title="All assets" sub={`${WINDOWS.find((w) => w.value === win)?.label} move`}>
            <HeatMap rows={rows} win={win} selected={asset?.symbol ?? null} onPick={onPick} />
          </Section>
        )}
      </div>
    </main>
  );
}

/** A part of the sheet under the chart: its title in BytNode's ink. */
function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
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
        <button type="button" className={`wlv-note${asset.note ? "" : " is-empty"}`} onClick={() => setDraft(asset.note ?? "")} title="Edit the note">
          <span>{asset.note || "Add a note"}</span>
          <Pencil />
        </button>
      ) : (
        <input
          className="wlv-input wlv-note-edit"
          aria-label={`Note on ${asset.symbol}`}
          value={draft}
          placeholder="Why you follow it"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={keep}
          onKeyDown={(e) => {
            if (e.key === "Enter") keep();
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
  const q = asset.quote;
  const [, quote] = pairOf(asset.symbol);
  const change = changeOf(q, win);
  const label = WINDOWS.find((w) => w.value === win)?.label ?? win;
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
        <p className="wlv-source">{q ? `${sourceName(q.source)} · ${timeOf(q.at)} · following since ${dateOf(asset.addedAt)}` : (asset.error ?? "No price for this pair")}</p>
      </div>
      <div className="wlv-ladder" role="radiogroup" aria-label="Change over">
        {WINDOWS.map((w) => {
          const c = changeOf(q, w.value);
          const heat = heatOf(c, w.value);
          return (
            <button key={w.value} type="button" role="radio" aria-checked={w.value === win} className={`wlv-rung ${moveOf(c)}${w.value === win ? " is-on" : ""}`} onClick={() => onWindow(w.value)}>
              <span className="wlv-rung-label">{w.label}</span>
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
