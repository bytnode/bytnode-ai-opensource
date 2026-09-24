"use client";

import { useRef, type CSSProperties, type MouseEvent } from "react";
import { changeOf, heatOf, type Window } from "@/lib/plugins/watchlist/heat";
import { useViewActive } from "../view-activity";
import { moveOf, pairOf, pct, priceText, type Row } from "./format";
import { useHeatField, type HeatTile } from "./heat-field";

/* Every asset of the list as a tile, washed by its move over the chosen
   window — the whole list read at a glance, like the week's grid in the
   calendar: square tiles, 2 px apart, one block round only at its outer
   corners. The wash is the GPU's (`heat-field.ts`); the text is the
   page's. A tile picks its asset. */

export function HeatMap({ rows, win, selected, onPick, onMenu }: { rows: Row[]; win: Window; selected: string | null; onPick: (symbol: string) => void; onMenu: (e: MouseEvent<HTMLElement>, symbol: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const active = useViewActive();
  const tiles: HeatTile[] = rows.map((r) => ({ heat: heatOf(changeOf(r.quote, win), win), selected: r.symbol === selected }));
  const hover = useHeatField(canvas, grid, tiles, active);

  return (
    <div className="wlv-heat" ref={grid} onPointerLeave={() => hover(-1)}>
      <canvas className="wlv-heat-canvas" ref={canvas} aria-hidden />
      {rows.map((r, i) => {
        const [base] = pairOf(r.symbol);
        const change = changeOf(r.quote, win);
        const heat = tiles[i].heat;
        return (
          <button
            key={r.symbol}
            type="button"
            data-tile
            className={`wlv-tile ${moveOf(change)}${r.symbol === selected ? " is-selected" : ""}`}
            style={{ "--mag": Math.abs(heat) } as CSSProperties}
            aria-pressed={r.symbol === selected}
            onPointerEnter={() => hover(i)}
            onFocus={() => hover(i)}
            onClick={() => onPick(r.symbol)}
            onContextMenu={(e) => onMenu(e, r.symbol)}
          >
            <span className="wlv-tile-name">{base}</span>
            <span className="wlv-tile-move">{pct(change)}</span>
            <span className="wlv-tile-price">{r.quote ? priceText(r.quote.price) : (r.error ?? "No price")}</span>
          </button>
        );
      })}
    </div>
  );
}
