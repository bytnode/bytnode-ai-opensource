"use client";

import { useRef, useState, type CSSProperties } from "react";
import { sortByMove, type Window } from "@/lib/plugins/watchlist/heat";
import { baseOf } from "@/lib/plugins/shared/quote";
import { WATCHLIST_DEFAULT, WATCHLIST_MAX, WATCHLIST_MIN, clampWatchlistWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import type { Row } from "./format";
import { ListPane } from "./list-pane";
import { Sheet } from "./sheet";
import "./watchlist.css";

/* ---------------------------------------------------------------------------
   The Watchlist tab: the assets the user follows — the same list the
   agents read — in the calendar's language. The list on the left (a
   light veil, its width the user's, `../column-handle.tsx`), the chosen
   asset on the right (one sheet): its price, its moves over four
   windows, and the whole list as a heat map painted on the GPU.

   The asset shown is the one clicked, else the one an agent opened the
   tab on (`params.symbol`), else the first. A new `params.symbol` wins
   over an earlier click: the pick is kept with the focus it was made
   under.
--------------------------------------------------------------------------- */

/** Prices are read again every minute while the tab is in front. */
const REFRESH = 60_000;

export function WatchlistView({ settings, params }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<Row[]>("watchlist", "list", settings);
  useAwakeInterval(reload, REFRESH);
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<Window>("24h");
  const [byMove, setByMove] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const focus = typeof params?.symbol === "string" ? params.symbol.toUpperCase() : null;
  const [pick, setPick] = useState<{ focus: string | null; symbol: string | null }>({ focus, symbol: null });

  const rows = data ?? null;
  const shown = sortByMove(rows ?? [], win, byMove);
  const picked = pick.focus === focus ? pick.symbol : null;
  const asset = rows?.find((r) => r.symbol === picked) ?? (focus ? rows?.find((r) => baseOf(r.symbol) === baseOf(focus)) : undefined) ?? shown[0] ?? null;
  const choose = (symbol: string) => setPick({ focus, symbol });

  const edit = async (change: Record<string, unknown>) => {
    const p = await act("watchlist", "edit", change, settings);
    setProblem(p);
    reload();
    return p === null;
  };
  const add = async (symbol: string, note: string) => {
    const ok = await edit({ add: [symbol], ...(note.trim() ? { note } : {}) });
    return ok;
  };

  return (
    <div className="wlv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.watchlistWidth}px` } as CSSProperties}>
        <ListPane rows={rows} shown={shown} selected={asset?.symbol ?? null} win={win} byMove={byMove} onWindow={setWin} onByMove={setByMove} onPick={choose} onAdd={add} />
        <ColumnHandle
          panel={panel}
          cssVar="--wlv-list"
          width={ui.watchlistWidth}
          min={WATCHLIST_MIN}
          max={WATCHLIST_MAX}
          reset={WATCHLIST_DEFAULT}
          clamp={clampWatchlistWidth}
          onCommit={(w) => updateUiPrefs({ watchlistWidth: w })}
          label="Width of the list"
        />
        <Sheet
          rows={rows}
          asset={asset}
          win={win}
          loading={loading}
          problem={problem ?? error ?? null}
          onWindow={setWin}
          onPick={choose}
          onReload={reload}
          onRemove={(symbol) => void edit({ remove: [symbol] })}
          onNote={(symbol, note) => void edit({ add: [symbol], note })}
        />
      </div>
    </div>
  );
}
