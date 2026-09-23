"use client";

import { useRef, useState, type CSSProperties } from "react";
import { sortByMove, type Window } from "@/lib/plugins/watchlist/heat";
import { withTick, type Candle, type Interval } from "@/lib/plugins/shared/candle";
import type { CandleSeries, Priced } from "@/lib/plugins/shared/prices";
import { baseOf, type Quote } from "@/lib/plugins/shared/quote";
import type { Insight } from "@/lib/plugins/watchlist/insight";
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
   asset on the right (one sheet): its price live, its moves over four
   windows, its chart, and the whole list as a heat map painted on the GPU.

   Three readings, three paces, all asleep with the tab: the chosen asset's
   price every 5 s (and it replaces that asset's row everywhere, so the
   list, the heat map and the sheet never disagree), its candles every
   minute (the live price moves the last one between two readings), the
   whole list every 30 s — every asset every 5 s would spend the user's
   BytNode quota for prices nobody is looking at. What is told about the
   asset under its chart (`insight`, one BytNode call) every minute.

   The asset shown is the one clicked, else the one an agent opened the
   tab on (`params.symbol`), else the first. A new `params.symbol` wins
   over an earlier click: the pick is kept with the focus it was made
   under.
--------------------------------------------------------------------------- */

const LIST_MS = 30_000;
const LIVE_MS = 5_000;
const CANDLES_MS = 60_000;
const CANDLES = 300;
const INSIGHT_MS = 60_000;

type InsightReading = { symbol: string; insight: Insight } | { symbol: string; error: string } | null;

export function WatchlistView({ settings, params }: ViewProps) {
  const list = usePluginData<Row[]>("watchlist", "list", settings);
  useAwakeInterval(list.reload, LIST_MS);
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<Window>("24h");
  const [interval, setChartInterval] = useState<Interval>("1h");
  const [byMove, setByMove] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const focus = typeof params?.symbol === "string" ? params.symbol.toUpperCase() : null;
  const [pick, setPick] = useState<{ focus: string | null; symbol: string | null }>({ focus, symbol: null });

  const listed = list.data ?? null;
  const picked = pick.focus === focus ? pick.symbol : null;
  const chosen = listed?.find((r) => r.symbol === picked) ?? (focus ? listed?.find((r) => baseOf(r.symbol) === baseOf(focus)) : undefined) ?? listed?.[0] ?? null;
  const symbol = chosen?.symbol ?? "";

  /* The chosen asset, live. A reading for another asset (the previous
     one, still on screen while the new one loads) is not used. */
  const live = usePluginData<Priced | null>("watchlist", "price", settings, { symbol });
  useAwakeInterval(live.reload, LIVE_MS);
  const series = usePluginData<CandleSeries | null>("watchlist", "candles", settings, { symbol, interval, limit: CANDLES });
  useAwakeInterval(series.reload, CANDLES_MS);
  const facts = usePluginData<InsightReading>("watchlist", "insight", settings, { symbol });
  useAwakeInterval(facts.reload, INSIGHT_MS);
  const factsNow = facts.data && facts.data.symbol === symbol ? facts.data : null;
  const liveQuote: Quote | null = live.data && live.data.symbol === symbol && !("error" in live.data) ? live.data : null;

  const rows = listed?.map((r) => (liveQuote && r.symbol === liveQuote.symbol ? { ...r, quote: liveQuote, error: null } : r)) ?? null;
  const asset = rows?.find((r) => r.symbol === symbol) ?? null;
  const shown = sortByMove(rows ?? [], win, byMove);
  const current = series.data && series.data.symbol === symbol && series.data.interval === interval ? series.data : null;
  const candles: Candle[] | null = current && "candles" in current ? (liveQuote ? withTick(current.candles, liveQuote.price, Date.parse(liveQuote.at), interval) : current.candles) : null;
  const chartMessage = !symbol ? null : current && "error" in current ? current.error : candles ? (candles.length ? null : "No candles for this pair.") : series.error ?? "Loading the chart…";

  const choose = (s: string) => setPick({ focus, symbol: s });
  const edit = async (change: Record<string, unknown>) => {
    const p = await act("watchlist", "edit", change, settings);
    setProblem(p);
    list.reload();
    return p === null;
  };
  const add = (s: string, note: string) => edit({ add: [s], ...(note.trim() ? { note } : {}) });

  return (
    <div className="wlv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.watchlistWidth}px` } as CSSProperties}>
        <ListPane rows={rows} shown={shown} selected={symbol || null} win={win} byMove={byMove} onWindow={setWin} onByMove={setByMove} onPick={choose} onAdd={add} />
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
          live={liveQuote !== null}
          win={win}
          interval={interval}
          candles={candles}
          chartMessage={chartMessage}
          insight={factsNow && "insight" in factsNow ? factsNow.insight : null}
          insightMessage={factsNow && "error" in factsNow ? factsNow.error : (facts.error ?? null)}
          loading={list.loading && !list.data}
          problem={problem ?? list.error ?? null}
          onWindow={setWin}
          onInterval={setChartInterval}
          onPick={choose}
          onReload={() => {
            list.reload();
            live.reload();
            series.reload();
            facts.reload();
          }}
          onRemove={(s) => void edit({ remove: [s] })}
          onNote={(s, note) => void edit({ add: [s], note })}
        />
      </div>
    </div>
  );
}
