"use client";

import { useState } from "react";
import { WINDOWS, changeOf, type Window } from "@/lib/plugins/watchlist/heat";
import { Plus } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { fmt } from "../bits";
import { moveOf, pairOf, pct, type Row } from "./format";

/* The left column: the list's name and size, the field that adds an
   asset, the window the moves are read over, and the assets themselves —
   each with its price and its move in a pill of Apple's green or red,
   like Stocks. A switch puts the biggest moves first. */

type Props = {
  rows: Row[] | null;
  shown: Row[];
  selected: string | null;
  win: Window;
  byMove: boolean;
  onWindow: (w: Window) => void;
  onByMove: (on: boolean) => void;
  onPick: (symbol: string) => void;
  onAdd: (symbol: string, note: string) => Promise<boolean>;
};

export function ListPane({ rows, shown, selected, win, byMove, onWindow, onByMove, onPick, onAdd }: Props) {
  return (
    <section className="wlv-pane wlv-side" aria-label="Your assets">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Watchlist</span>
        </h2>
        {rows && rows.length > 0 && <span className="wlv-count">{rows.length}</span>}
      </header>
      <AddField onAdd={onAdd} />
      <div className="wlv-windows">
        <Segmented label="Change over" value={win} options={WINDOWS} onChange={onWindow} wide />
      </div>
      {shown.length > 0 && (
        <ul className="wlv-rows" aria-label="Assets">
          {shown.map((r) => {
            const [base, quote] = pairOf(r.symbol);
            const change = changeOf(r.quote, win);
            const on = r.symbol === selected;
            return (
              <li key={r.symbol}>
                <button type="button" className={`wlv-row${on ? " is-selected" : ""}`} aria-current={on || undefined} onClick={() => onPick(r.symbol)}>
                  <span className="wlv-row-name">
                    <b>{base}</b>
                    <small>{r.note || quote}</small>
                  </span>
                  <span className="wlv-row-price">{r.quote ? fmt(r.quote.price) : "—"}</span>
                  <span className={`wlv-pill ${moveOf(change)}`}>{pct(change)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 1 && (
        <div className="wlv-switches">
          <label className="wlv-switch">
            <span>Biggest moves first</span>
            <Switch on={byMove} onChange={onByMove} label="Biggest moves first" />
          </label>
        </div>
      )}
    </section>
  );
}

/** The asset to add, and a note once there is an asset. */
function AddField({ onAdd }: { onAdd: (symbol: string, note: string) => Promise<boolean> }) {
  const [symbol, setSymbol] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!symbol.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd(symbol, note);
    setBusy(false);
    if (ok) {
      setSymbol("");
      setNote("");
    }
  };
  return (
    <form
      className="wlv-add"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="wlv-add-row">
        <input className="wlv-input" aria-label="Asset to add" placeholder="Add an asset — btc, ETH/USDT…" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" className="wlv-add-btn" disabled={!symbol.trim() || busy} aria-label="Add to the watchlist" title="Add to the watchlist">
          <Plus />
        </button>
      </div>
      {symbol.trim() && <input className="wlv-input wlv-note-input" aria-label="Note" placeholder="Why you follow it (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
    </form>
  );
}
