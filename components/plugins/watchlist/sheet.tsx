"use client";

import { useState } from "react";
import { WINDOWS, changeOf, heatOf, type Window } from "@/lib/plugins/watchlist/heat";
import { Pencil, Refresh, Trash } from "@/components/ui/icons";
import { fmt } from "../bits";
import { dateOf, moveOf, pairOf, pct, sourceName, timeOf, type Row } from "./format";
import { HeatMap } from "./heat-map";

/* The right sheet: the chosen asset — its name in BytNode's ink, its
   note (edited in place), its price large and its move over the chosen
   window — then its four windows side by side as one row of tiles, and
   under them every asset of the list as a heat map. The state of the
   prices and the two actions (read again, remove) sit discreetly in the
   corner, like the calendar's collection. */

type Props = {
  rows: Row[] | null;
  asset: Row | null;
  win: Window;
  loading: boolean;
  problem: string | null;
  onWindow: (w: Window) => void;
  onPick: (symbol: string) => void;
  onReload: () => void;
  onRemove: (symbol: string) => void;
  onNote: (symbol: string, note: string) => void;
};

export function Sheet({ rows, asset, win, loading, problem, onWindow, onPick, onReload, onRemove, onNote }: Props) {
  const stamps = (rows ?? []).flatMap((r) => (r.quote ? [r.quote.at] : [])).sort();
  const status = loading ? "Updating…" : stamps.length ? `Updated ${timeOf(stamps[stamps.length - 1])}` : rows ? "No price yet" : "Loading…";

  return (
    <main className="wlv-pane wlv-sheet">
      <header className="wlv-head">
        {asset ? (
          <AssetTitle key={asset.symbol} asset={asset} onNote={onNote} />
        ) : (
          <div>
            <h2 className="wlv-sheet-title">
              <span className="pv-ink">{rows ? "Nothing followed yet" : "Watchlist"}</span>
            </h2>
            <p className="wlv-sheet-sub">{rows ? "Add an asset on the left, or ask an agent: “add BTC and ETH to my watchlist”." : "Reading your assets…"}</p>
          </div>
        )}
        <span className="wlv-spacer" />
        <span className="wlv-status">{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} disabled={loading} aria-label="Read the prices again" title="Read the prices again">
          <Refresh />
        </button>
        {asset && (
          <button type="button" className="wlv-icon" onClick={() => onRemove(asset.symbol)} aria-label={`Remove ${asset.symbol}`} title="Remove from the watchlist">
            <Trash />
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}
      {asset && <Figures asset={asset} win={win} onWindow={onWindow} />}
      {rows && rows.length > 0 && (
        <>
          <p className="wlv-map-title">
            <span className="pv-ink">All assets</span>
            <small>{WINDOWS.find((w) => w.value === win)?.label} move</small>
          </p>
          <div className="pv-tiles wlv-map">
            <HeatMap rows={rows} win={win} selected={asset?.symbol ?? null} onPick={onPick} />
          </div>
        </>
      )}
    </main>
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

/** The price, the move, where it comes from — and the four windows as
    one row of tiles, the chosen one lit; a tile chooses its window. */
function Figures({ asset, win, onWindow }: { asset: Row; win: Window; onWindow: (w: Window) => void }) {
  const q = asset.quote;
  const [, quote] = pairOf(asset.symbol);
  const change = changeOf(q, win);
  const label = WINDOWS.find((w) => w.value === win)?.label ?? win;
  return (
    <div className="wlv-figures">
      <div className="wlv-hero">
        <p className="wlv-price">
          {q ? fmt(q.price) : "—"}
          {q && quote && <span className="wlv-price-unit">{quote}</span>}
        </p>
        <p className={`wlv-move ${moveOf(change)}`}>
          {pct(change)}
          <span>over {label}</span>
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
