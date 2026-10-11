"use client";

import { useRef, useState, type CSSProperties } from "react";
import { sortByMove, type Window } from "@/lib/plugins/watchlist/heat";
import { withTick, type Candle, type Interval } from "@/lib/plugins/shared/candle";
import type { CandleSeries, Listed, Priced } from "@/lib/plugins/shared/prices";
import { named } from "@/lib/plugins/watchlist/suggest";
import { baseOf, type Quote } from "@/lib/plugins/shared/quote";
import type { Insight } from "@/lib/plugins/watchlist/insight";
import type { Technicals } from "@/lib/plugins/watchlist/technicals";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import { COMING_DAYS, comingFor } from "./coming-up";
import { WATCHLIST_DEFAULT, WATCHLIST_MAX, WATCHLIST_MIN, clampWatchlistWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import type { Row } from "./format";
import { ListPane } from "./list-pane";
import { Sheet } from "./sheet";
import { AssetMenu, useAssetMenu } from "./asset-menu";
import { useMessages } from "@/lib/i18n/react";
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

   Coming back to an asset shows what was read for it at once (every
   answer is kept, `../use-plugin-data.ts`) and refreshes it silently.

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
type TechnicalsReading = { symbol: string; interval: Interval; technicals: Technicals } | { symbol: string; interval: Interval; error: string } | null;
/** The calendar's events are collected in the background: read now and then. */
const EVENTS_MS = 5 * 60_000;

export function WatchlistView({ settings, params }: ViewProps) {
  const m = useMessages();
  const list = usePluginData<Row[]>("watchlist", "list", settings, {}, { keep: "latest" });
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
  const series = usePluginData<CandleSeries | null>("watchlist", "candles", settings, { symbol, interval, limit: CANDLES }, { keep: "exact" });
  useAwakeInterval(series.reload, CANDLES_MS);
  const facts = usePluginData<InsightReading>("watchlist", "insight", settings, { symbol }, { keep: "exact" });
  useAwakeInterval(facts.reload, INSIGHT_MS);
  const factsNow = facts.data && facts.data.symbol === symbol ? facts.data : null;
  const signals = usePluginData<TechnicalsReading>("watchlist", "technicals", settings, { symbol, interval }, { keep: "exact" });
  useAwakeInterval(signals.reload, INSIGHT_MS);
  const signalsNow = signals.data && signals.data.symbol === symbol && signals.data.interval === interval ? signals.data : null;
  /* The Calendar plugin's events of the next weeks, for "coming up" —
     when the plugin is off, its call fails and the section stays away. */
  const [from] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  });
  const calendar = usePluginData<{ events: CalendarEvent[] }>("calendar", "week", settings, { from, days: COMING_DAYS }, { keep: "exact" });
  useAwakeInterval(calendar.reload, EVENTS_MS);
  const coming = calendar.data && symbol ? comingFor(calendar.data.events, baseOf(symbol), Date.parse(from)) : null;
  const liveQuote: Quote | null = live.data && live.data.symbol === symbol && !("error" in live.data) ? live.data : null;

  /* The live quote replaces its row's — unless the row's is fresher (a
     live quote kept from an earlier visit, while the new one loads). */
  const fresher = (r: Row) => liveQuote && r.symbol === liveQuote.symbol && (!r.quote || Date.parse(liveQuote.at) >= Date.parse(r.quote.at));
  const rows = listed?.map((r) => (fresher(r) ? { ...r, quote: liveQuote, error: null } : r)) ?? null;
  const asset = rows?.find((r) => r.symbol === symbol) ?? null;
  const shown = sortByMove(rows ?? [], win, byMove);
  const current = series.data && series.data.symbol === symbol && series.data.interval === interval ? series.data : null;
  const candles: Candle[] | null = current && "candles" in current ? (liveQuote ? withTick(current.candles, liveQuote.price, Date.parse(liveQuote.at), interval) : current.candles) : null;
  const chartMessage = !symbol ? null : current && "error" in current ? current.error : candles ? (candles.length ? null : m.watchlist.noCandles) : (series.error ?? m.watchlist.loadingChart);

  /* What the add field proposes: BytNode's assets only. Read once, and
     again when the tab wakes (a key added meanwhile). */
  const pairs = usePluginData<Listed[]>("watchlist", "symbols", settings, {}, { keep: "latest" });
  useOnWake(pairs.reload);
  const listedPairs = Array.isArray(pairs.data) ? pairs.data : null;
  const catalog = named(listedPairs ?? []);
  const addUnavailable = !settings.keys.bytnode.trim() ? m.watchlist.needKey : listedPairs && !listedPairs.length ? m.watchlist.listUnreadable : null;

  const choose = (s: string) => setPick({ focus, symbol: s });
  const menu = useAssetMenu();
  const edit = async (change: Record<string, unknown>) => {
    const p = await act("watchlist", "edit", change, settings);
    setProblem(p);
    list.reload();
    return p === null;
  };
  const add = (s: string) => edit({ add: [s] });

  return (
    <div className="wlv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.watchlistWidth}px` } as CSSProperties}>
        <ListPane rows={rows} shown={shown} selected={symbol || null} win={win} byMove={byMove} catalog={catalog} addUnavailable={addUnavailable} onWindow={setWin} onByMove={setByMove} onPick={choose} onMenu={menu.open} onAdd={add} />
        <ColumnHandle
          panel={panel}
          cssVar="--wlv-list"
          width={ui.watchlistWidth}
          min={WATCHLIST_MIN}
          max={WATCHLIST_MAX}
          reset={WATCHLIST_DEFAULT}
          clamp={clampWatchlistWidth}
          onCommit={(w) => updateUiPrefs({ watchlistWidth: w })}
          label={m.watchlist.listWidth}
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
          technicals={signalsNow && "technicals" in signalsNow ? signalsNow.technicals : null}
          technicalsMessage={signalsNow && "error" in signalsNow ? signalsNow.error : (signals.error ?? null)}
          coming={coming}
          loading={list.loading && !list.data}
          problem={problem ?? list.error ?? null}
          onWindow={setWin}
          onInterval={setChartInterval}
          onPick={choose}
          onMenu={menu.open}
          onReload={() => {
            list.reload();
            live.reload();
            series.reload();
            facts.reload();
            signals.reload();
            calendar.reload();
          }}
          onRemove={(s) => void edit({ remove: [s] })}
          onNote={(s, note) => void edit({ add: [s], note })}
        />
      </div>
      {menu.at && <AssetMenu at={menu.at} onClose={menu.close} onShow={choose} onRemove={(s) => void edit({ remove: [s] })} />}
    </div>
  );
}
