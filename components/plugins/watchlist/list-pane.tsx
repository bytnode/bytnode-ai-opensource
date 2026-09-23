"use client";

import { WINDOWS, changeOf, type Window } from "@/lib/plugins/watchlist/heat";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { Candidate } from "@/lib/plugins/watchlist/suggest";
import { AddField } from "./add-field";
import { moveOf, pairOf, pct, priceText, type Row } from "./format";

/* The left column: the list's name and size, the field that adds an
   asset (a search, `add-field.tsx`), the window the moves are read over, and the assets themselves —
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
  catalog: Candidate[];
  onAdd: (symbol: string) => Promise<boolean>;
};

export function ListPane({ rows, shown, selected, win, byMove, catalog, onWindow, onByMove, onPick, onAdd }: Props) {
  return (
    <section className="wlv-pane wlv-side" aria-label="Your assets">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Watchlist</span>
        </h2>
        {rows && rows.length > 0 && <span className="wlv-count">{rows.length}</span>}
      </header>
      <AddField catalog={catalog} followed={new Set((rows ?? []).map((r) => r.symbol))} onAdd={onAdd} onPick={onPick} />
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
                  <span className="wlv-row-price">{r.quote ? priceText(r.quote.price) : "—"}</span>
                  <span className={`wlv-pill ${moveOf(change)}`}>{pct(change)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 1 && (
        <div className="wlv-switches pv-rule">
          <label className="wlv-switch">
            <span>Biggest moves first</span>
            <Switch on={byMove} onChange={onByMove} label="Biggest moves first" />
          </label>
        </div>
      )}
    </section>
  );
}
