"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "@/lib/domain/types";
import type { WidgetKind, WidgetSize } from "@/lib/widgets/catalog";
import { widgetInfo } from "@/lib/widgets/catalog";
import { pluginManifest } from "@/lib/plugins/catalog";
import { pluginSettings, resolveConfig } from "@/lib/plugins/core/state";
import type { CalendarEvent } from "@/lib/plugins/calendar/events";
import type { Alert, Trigger } from "@/lib/plugins/alerts/alerts";
import { alertWords } from "@/lib/plugins/alerts/words";
import { dailySeries } from "@/lib/plugins/portfolio/view-model";
import type { Summary, Snapshot } from "@/lib/plugins/portfolio/aggregate";
import type { Money } from "@/lib/plugins/portfolio/present";
import { nextDue, planFigures, sumFigures, unitOf, frequencyWords, type PlanRow } from "@/lib/plugins/dca/view-model";
import { frequencyText, relative } from "@/lib/plugins/scheduler/timeline";
import { positionSize } from "@/lib/plugins/position-calc/calc";
import type { Candle } from "@/lib/plugins/shared/candle";
import { useNow } from "@/lib/state/clock";
import { useMessages } from "@/lib/i18n/react";
import { numberTag } from "@/lib/i18n/store";
import { usePluginData } from "@/components/plugins/use-plugin-data";
import { useLiveQuotes } from "@/components/plugins/use-live-quotes";
import { useAwakeInterval } from "@/components/plugins/view-activity";
import { TabIcon } from "@/components/shell/tab-icons";
import { pairOf, pct, priceText, type Row } from "@/components/plugins/watchlist/format";
import type { BookRow, PaperState } from "@/components/plugins/paper-trading/format";
import { TONE as CAL_TONE } from "@/components/plugins/calendar/format";
import type { Tone } from "./widget-field";

/* ---------------------------------------------------------------------------
   Each widget: an excerpt of its plugin, read through the plugin's own view
   actions — the same data as its tab, polled more slowly (a widget is a
   glance, and the BytNode quota is the user's). Three sizes: small says the
   one thing that matters, medium adds the next few, large the list. Each
   gives the column its light (`onTone`): green when it rises, red when it
   falls, the app's blue or a calendar's violet otherwise.
--------------------------------------------------------------------------- */

type Props = { size: WidgetSize; settings: Settings; onTone: (t: Tone) => void };

const UP: Tone["rgb"] = [0.19, 0.82, 0.35];
const DOWN: Tone["rgb"] = [1, 0.27, 0.23];
const BLUE: Tone["rgb"] = [0.04, 0.52, 1];
const VIOLET: Tone["rgb"] = [0.6, 0.4, 1];
const AMBER: Tone["rgb"] = [1, 0.62, 0.04];

const moveTone = (v: number | undefined): Tone => (v === undefined || !Number.isFinite(v) || Math.abs(v) < 0.01 ? { rgb: BLUE, strength: 0.45 } : { rgb: v > 0 ? UP : DOWN, strength: Math.min(0.75, 0.4 + Math.abs(v) / 10) });
const moveClass = (v: number | undefined) => (v === undefined || !Number.isFinite(v) || Math.abs(v) < 0.005 ? "is-flat" : v > 0 ? "is-up" : "is-down");

/** Tells the column its light whenever it changes. */
function useTone(onTone: (t: Tone) => void, tone: Tone) {
  const key = `${tone.rgb.join(",")}:${tone.strength.toFixed(2)}`;
  useEffect(() => {
    onTone(tone);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the tone changed
  }, [onTone, key]);
}

export function WidgetBody({ kind, size, settings, onTone }: { kind: WidgetKind; size: WidgetSize; settings: Settings; onTone: (t: Tone) => void }) {
  const p = { size, settings, onTone };
  switch (kind) {
    case "watchlist":
      return <WatchlistWidget {...p} />;
    case "portfolio":
      return <PortfolioWidget {...p} />;
    case "paper":
      return <PaperWidget {...p} />;
    case "dca":
      return <DcaWidget {...p} />;
    case "calendar":
      return <CalendarWidget {...p} />;
    case "scheduler":
      return <SchedulerWidget {...p} />;
    case "alerts":
      return <AlertsWidget {...p} />;
    case "calculator":
      return <CalculatorWidget {...p} />;
  }
}

/* --- Shared pieces ------------------------------------------------------------ */

/** The widget's name, as Apple's: its icon and its plugin, quiet. */
function Head({ kind, aside }: { kind: WidgetKind; aside?: ReactNode }) {
  const m = useMessages();
  const info = widgetInfo(kind)!;
  return (
    <div className="wg-name">
      <TabIcon view={info.view ?? "position-calc"} />
      <span>{m.widgets.kinds[kind].name}</span>
      {aside && <span className="wg-name-aside">{aside}</span>}
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="wg-quiet">{children}</p>;
}

/** A small line of a series, in the widget's tone. */
function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 32;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg className={`wg-spark ${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path className="wg-spark-area" d={`${line} L${W},${H} L0,${H} Z`} />
      <path className="wg-spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const money = (n: number | undefined, unit: string, digits = 2) =>
  n === undefined || !Number.isFinite(n) ? "—" : `${n.toLocaleString(numberTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
const signedPct = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} %`);

const ROWS: Record<WidgetSize, number> = { small: 1, medium: 3, large: 7 };

/* --- Watchlist ---------------------------------------------------------------- */

function WatchlistWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const { data, error, reload } = usePluginData<Row[]>("watchlist", "list", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, 60_000);
  /* The prices live, as in the Watchlist tab. */
  const live = useLiveQuotes((data ?? []).map((r) => r.symbol), settings);
  const rows = (data ?? [])
    .map((r) => {
      const q = live.quotes.get(r.symbol);
      /* A live quote wins unless the list's own is fresher. */
      return q && (!r.quote || Date.parse(q.at) >= Date.parse(r.quote.at)) ? { ...r, quote: q, error: null } : r;
    })
    .filter((r) => r.quote);
  const first = rows[0];
  const candles = usePluginData<{ candles: Candle[] } | null>("watchlist", "candles", settings, { symbol: first?.symbol ?? "", interval: "1h", limit: 48 }, { keep: "exact" });
  useAwakeInterval(candles.reload, 300_000);
  const avg = rows.length ? rows.reduce((s, r) => s + (r.quote?.change24h ?? 0), 0) / rows.length : undefined;
  useTone(onTone, moveTone(size === "small" ? first?.quote?.change24h : avg));

  if (!data && error) return <><Head kind="watchlist" /><Quiet>{error}</Quiet></>;
  if (data && rows.length === 0) return <><Head kind="watchlist" /><Quiet>{m.widgets.watchlistEmpty}</Quiet></>;
  if (!first) return <><Head kind="watchlist" /><Quiet>{m.common.loading}</Quiet></>;

  if (size === "small") {
    const [base, quote] = pairOf(first.symbol);
    const ch = first.quote?.change24h;
    return (
      <>
        <Head kind="watchlist" />
        <div className="wg-hero">
          <span className="wg-sym">
            {base}
            <small>/{quote}</small>
          </span>
          <span className="wg-big">{priceText(first.quote!.price)}</span>
          <span className={`wg-move ${moveClass(ch)}`}>{pct(ch)}</span>
        </div>
        <Spark values={(candles.data?.candles ?? []).map((c) => c.c)} tone={moveClass(ch)} />
      </>
    );
  }
  return (
    <>
      <Head kind="watchlist" aside={m.widgets.last24h} />
      <ul className="wg-rows">
        {rows.slice(0, ROWS[size]).map((r) => {
          const [base, quote] = pairOf(r.symbol);
          const ch = r.quote?.change24h;
          return (
            <li key={r.symbol} className="wg-row">
              <span className="wg-row-name">
                <b>{base}</b>
                <small>/{quote}</small>
              </span>
              <span className="wg-row-value">{priceText(r.quote!.price)}</span>
              <span className={`wg-pill ${moveClass(ch)}`}>{pct(ch)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* --- Portfolio ---------------------------------------------------------------- */

type Current = { summary: Summary; money: Money; at: string };

function PortfolioWidget({ size, settings, onTone }: Props) {
  const t = useMessages();
  const manifest = pluginManifest("portfolio");
  const currency = manifest ? String(resolveConfig(manifest, pluginSettings(settings.plugins, "portfolio").config).currency) : "USD";
  const cur = usePluginData<Current>("portfolio", "summary", settings, { currency }, { keep: "latest" });
  useAwakeInterval(cur.reload, 300_000);
  const hist = usePluginData<{ points: Snapshot[] }>("portfolio", "history", settings, { days: 31 }, { keep: "latest" });
  useAwakeInterval(hist.reload, 900_000);
  const m = cur.data?.money;
  const series = m && hist.data ? dailySeries(hist.data.points, m.perUsd).map((c) => c.c) : [];
  const total = cur.data ? cur.data.summary.totalUsd * (m?.perUsd ?? 1) : undefined;
  const ref = series.length >= 2 ? series[series.length - 2] : undefined;
  const counted = total !== undefined && total > 0;
  const day = counted && ref ? ((total - ref) / ref) * 100 : undefined;
  const month = counted && series.length >= 2 && series[0] ? ((total - series[0]) / series[0]) * 100 : undefined;
  useTone(onTone, moveTone(day ?? month));

  if (!cur.data) return <><Head kind="portfolio" /><Quiet>{cur.error ?? t.widgets.readingAccounts}</Quiet></>;
  if (cur.data.summary.accounts.length === 0 || cur.data.summary.totalUsd <= 0)
    return <><Head kind="portfolio" /><Quiet>{t.widgets.portfolioEmpty}</Quiet></>;
  const unit = m?.currency ?? "USD";
  const assets = cur.data.summary.assets.filter((a) => a.usd > 0);
  return (
    <>
      <Head kind="portfolio" aside={size === "small" ? undefined : t.widgets.last30d} />
      <div className="wg-hero">
        <span className="wg-big">{money(total, unit, total !== undefined && total >= 100_000 ? 0 : 2)}</span>
        <span className={`wg-move ${moveClass(day)}`}>
          {signedPct(day)}
          <small> {t.widgets.today}</small>
        </span>
      </div>
      {size !== "small" && series.length >= 2 && (
        <>
          <Spark values={series} tone={moveClass(month)} />
          <p className="wg-foot">
            {t.widgets.over30d(<span className={moveClass(month)}>{signedPct(month)}</span>)}
          </p>
        </>
      )}
      {size === "large" && assets.length > 0 && (
        <ul className="wg-shares">
          {assets.slice(0, 5).map((a) => (
            <li key={a.asset}>
              <span className="wg-share-name">{a.asset}</span>
              <span className="wg-share-bar">
                <i style={{ width: `${Math.max(2, a.share * 100)}%` }} />
              </span>
              <span className="wg-share-pct">{(a.share * 100).toFixed(1)} %</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* --- Paper trading -------------------------------------------------------------- */

function PaperWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const books = usePluginData<BookRow[]>("paper-trading", "books", settings, {}, { keep: "latest" });
  useAwakeInterval(books.reload, 60_000);
  const book = books.data?.[0];
  const state = usePluginData<PaperState>("paper-trading", "state", settings, { portfolio: book?.id ?? "" }, { keep: "exact" });
  useAwakeInterval(state.reload, size === "small" ? 600_000 : 60_000);
  const ret = state.data?.valuation.returnPct ?? book?.returnPct;
  useTone(onTone, moveTone(ret));

  if (!books.data) return <><Head kind="paper" /><Quiet>{books.error ?? m.common.loading}</Quiet></>;
  if (!book) return <><Head kind="paper" /><Quiet>{m.widgets.noPaperPortfolio}</Quiet></>;
  const equity = state.data?.valuation.equity ?? book.equity;
  const positions = state.data?.valuation.positions ?? [];
  const holdings = (state.data?.valuation.holdings ?? []).filter((h) => (h.value ?? 0) > 1);
  return (
    <>
      <Head kind="paper" aside={books.data.length > 1 ? book.name : undefined} />
      <div className="wg-hero">
        <span className="wg-big">{money(equity, "USDT")}</span>
        <span className={`wg-move ${moveClass(ret)}`}>
          {signedPct(ret)}
          <small> {m.widgets.sinceStart}</small>
        </span>
      </div>
      {size !== "small" &&
        (positions.length + holdings.length === 0 ? (
          <p className="wg-foot">{m.widgets.noOpenPosition}</p>
        ) : (
          <ul className="wg-rows">
            {positions.slice(0, size === "large" ? 5 : 2).map((p) => (
              <li key={p.symbol + p.side} className="wg-row">
                <span className="wg-row-name">
                  <b>{p.symbol.split("/")[0]}</b>
                  <small>{p.side === "long" ? m.widgets.long : m.widgets.short} ×{p.leverage}</small>
                </span>
                <span className={`wg-pill ${moveClass(p.unrealized)}`}>{p.unrealized === undefined ? "—" : `${p.unrealized >= 0 ? "+" : "−"}${Math.abs(p.unrealized).toFixed(2)}`}</span>
              </li>
            ))}
            {holdings.slice(0, Math.max(0, (size === "large" ? 5 : 2) - positions.length)).map((h) => (
              <li key={h.asset} className="wg-row">
                <span className="wg-row-name">
                  <b>{h.asset}</b>
                  <small>{m.widgets.spot}</small>
                </span>
                <span className={`wg-pill ${moveClass(h.unrealized)}`}>{money(h.value, "USDT")}</span>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/* --- DCA ---------------------------------------------------------------------- */

type DcaState = { plans: PlanRow[] };

function DcaWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const { data, error, reload } = usePluginData<DcaState>("dca", "state", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, 60_000);
  const prices = usePluginData<{ prices: Record<string, number> }>("dca", "prices", settings, {}, { keep: "latest" });
  useAwakeInterval(prices.reload, 300_000);
  const now = useNow();
  const plans = (data?.plans ?? []).filter((p) => p.status === "active");
  const all = sumFigures((data?.plans ?? []).map((p) => planFigures(p, prices.data?.prices[p.symbol])));
  useTone(onTone, all.pct !== undefined ? moveTone(all.pct) : { rgb: BLUE, strength: 0.5 });

  if (!data) return <><Head kind="dca" /><Quiet>{error ?? m.common.loading}</Quiet></>;
  if (plans.length === 0) return <><Head kind="dca" /><Quiet>{m.widgets.noActivePlan}</Quiet></>;
  const next = nextDue(plans);
  const soon = plans.filter((p) => p.nextDue).sort((a, b) => Date.parse(a.nextDue!) - Date.parse(b.nextDue!));
  const unit = unitOf(data.plans);
  return (
    <>
      <Head kind="dca" />
      {size === "small" ? (
        <div className="wg-hero">
          <span className="wg-label">{m.widgets.nextPurchase}</span>
          <span className="wg-big is-mid">{next && now ? relative(next, now) : "—"}</span>
          <span className="wg-sub">
            {soon[0] ? `${soon[0].name ?? soon[0].symbol} · ${money(soon[0].quoteAmount, unit, 0)}` : ""}
          </span>
        </div>
      ) : (
        <>
          <div className="wg-facts">
            <div>
              <span className="wg-label">{m.widgets.invested}</span>
              <span className="wg-fact">{money(all.invested, unit, 0)}</span>
            </div>
            <div>
              <span className="wg-label">{m.widgets.return}</span>
              <span className={`wg-fact ${moveClass(all.pct)}`}>{signedPct(all.pct)}</span>
            </div>
          </div>
          <ul className="wg-rows">
            {soon.slice(0, size === "large" ? 5 : 2).map((p) => (
              <li key={p.id} className="wg-row">
                <span className="wg-row-name">
                  <b>{p.name ?? p.symbol}</b>
                  <small>{money(p.quoteAmount, unit, 0)} · {frequencyWords(p.frequency)}</small>
                </span>
                <span className="wg-row-when">{now ? relative(p.nextDue, now) : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* --- Calendar ----------------------------------------------------------------- */

function CalendarWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const { data, error, reload } = usePluginData<{ events: CalendarEvent[] }>("calendar", "week", settings, { days: 7 }, { keep: "latest" });
  useAwakeInterval(reload, 300_000);
  const now = useNow();
  useTone(onTone, { rgb: VIOLET, strength: 0.55 });
  if (!data) return <><Head kind="calendar" /><Quiet>{error ?? m.common.loading}</Quiet></>;
  const events = data.events.filter((e) => !e.done && (!now || Date.parse(e.startsAt) >= now - 3_600_000)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (events.length === 0) return <><Head kind="calendar" /><Quiet>{m.widgets.nothingThisWeek}</Quiet></>;
  const when = (e: CalendarEvent) => (now ? relative(e.startsAt, now) : "");
  if (size === "small") {
    const e = events[0];
    return (
      <>
        <Head kind="calendar" />
        <div className="wg-hero">
          <span className="wg-label" style={{ color: CAL_TONE[e.category] }}>{when(e)}</span>
          <span className="wg-event-title">{e.title}</span>
          {events.length > 1 && <span className="wg-sub">{m.widgets.moreThisWeek(events.length - 1)}</span>}
        </div>
      </>
    );
  }
  return (
    <>
      <Head kind="calendar" aside={m.widgets.last7d} />
      <ul className="wg-events">
        {events.slice(0, size === "large" ? 6 : 2).map((e) => (
          <li key={e.id} style={{ "--tone": CAL_TONE[e.category] } as React.CSSProperties}>
            <span className="wg-event-when">{when(e)}</span>
            <span className="wg-event-title">{e.title}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* --- Scheduled tasks ---------------------------------------------------------- */

type TaskRow = { id: string; title: string; frequency: string; status: "active" | "paused"; running: boolean; state: { nextRun?: string; lastStatus?: "ok" | "failed" } };
type RunRow = { id: string; title: string; finishedAt: string; ok: boolean; excerpt?: string };
type SchedulerState = { at: string; tasks: TaskRow[]; runs: RunRow[] };

function SchedulerWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const { data, error, reload } = usePluginData<SchedulerState>("scheduler", "state", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, 30_000);
  const failed = data?.runs[0] && !data.runs[0].ok;
  useTone(onTone, data?.tasks.some((t) => t.running) ? { rgb: BLUE, strength: 0.8 } : failed ? { rgb: DOWN, strength: 0.55 } : { rgb: BLUE, strength: 0.45 });
  if (!data) return <><Head kind="scheduler" /><Quiet>{error ?? m.common.loading}</Quiet></>;
  const now = Date.parse(data.at);
  const tasks = data.tasks.filter((t) => t.status === "active").sort((a, b) => Date.parse(a.state.nextRun ?? "9999") - Date.parse(b.state.nextRun ?? "9999"));
  if (tasks.length === 0) return <><Head kind="scheduler" /><Quiet>{m.widgets.noScheduledTask}</Quiet></>;
  if (size === "small") {
    const t = tasks[0];
    return (
      <>
        <Head kind="scheduler" />
        <div className="wg-hero">
          <span className="wg-label">{t.running ? m.widgets.runningNow : m.widgets.nextRun}</span>
          <span className="wg-big is-mid">{t.running ? "…" : relative(t.state.nextRun, now)}</span>
          <span className="wg-sub">{t.title}</span>
        </div>
      </>
    );
  }
  return (
    <>
      <Head kind="scheduler" />
      <ul className="wg-rows">
        {tasks.slice(0, size === "large" ? 4 : 3).map((t) => (
          <li key={t.id} className="wg-row">
            <span className="wg-row-name">
              <b>{t.title}</b>
              <small>{frequencyText(t.frequency)}</small>
            </span>
            <span className={`wg-row-when${t.running ? " is-now" : ""}`}>{t.running ? m.widgets.running : relative(t.state.nextRun, now)}</span>
          </li>
        ))}
      </ul>
      {size === "large" && data.runs.length > 0 && (
        <>
          <p className="wg-label wg-gap">{m.widgets.lastReports}</p>
          <ul className="wg-rows">
            {data.runs.slice(0, 2).map((r) => (
              <li key={r.id} className="wg-row">
                <span className="wg-row-name">
                  <b>{r.title}</b>
                  <small>{r.ok ? (r.excerpt ?? m.widgets.runDone) : m.widgets.runFailed}</small>
                </span>
                <span className="wg-row-when">{relative(r.finishedAt, now)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* --- Alerts ------------------------------------------------------------------- */

function AlertsWidget({ size, settings, onTone }: Props) {
  const m = useMessages();
  const { data, error, reload } = usePluginData<{ alerts: Alert[]; triggers: Trigger[] }>("alerts", "state", settings);
  useAwakeInterval(reload, 60_000);
  const now = useNow();
  const recent = data?.triggers[0] && now && now - Date.parse(data.triggers[0].at) < 6 * 3_600_000;
  useTone(onTone, recent ? { rgb: AMBER, strength: 0.75 } : { rgb: BLUE, strength: 0.4 });
  if (!data) return <><Head kind="alerts" /><Quiet>{error ?? m.common.loading}</Quiet></>;
  const active = data.alerts.filter((a) => a.status === "active");
  const last = data.triggers[0];
  if (size === "small")
    return (
      <>
        <Head kind="alerts" />
        <div className="wg-hero">
          <span className="wg-big">{active.length}</span>
          <span className="wg-sub">{m.widgets.alertsWatching(active.length)}</span>
          {last && (
            <span className={`wg-label${recent ? " is-hot" : ""}`}>
              {m.widgets.fired(last.symbol.split("/")[0], now ? relative(last.at, now) : "")}
            </span>
          )}
        </div>
      </>
    );
  return (
    <>
      <Head kind="alerts" aside={m.widgets.activeCount(active.length)} />
      {active.length === 0 ? (
        <Quiet>{m.widgets.noActiveAlert}</Quiet>
      ) : (
        <ul className="wg-rows">
          {active.slice(0, size === "large" ? 5 : 3).map((a) => {
            const seen = Object.entries(a.state)[0];
            return (
              <li key={a.id} className="wg-row">
                <span className="wg-row-name">
                  <b>{a.target === "watchlist" ? m.widgets.kinds.watchlist.name : a.target.split("/")[0]}</b>
                  <small>{alertWords(a.condition)}</small>
                </span>
                <span className={`wg-row-when${seen?.[1].holds ? " is-hot" : ""}`}>{seen?.[1].observed ?? "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {size === "large" && last && (
        <p className="wg-foot">
          {m.widgets.lastFired(<b>{last.symbol.split("/")[0]}</b>, now ? relative(last.at, now) : "", last.observed)}
        </p>
      )}
    </>
  );
}

/* --- Position size (computed here, from the plugin's own pure function) -------- */

const CALC_KEY = "agentchat:widget-calculator";

function readCalc(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CALC_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function CalculatorWidget({ size, onTone }: Props) {
  const m = useMessages();
  const c = m.widgets.calculator;
  const [v, setV] = useState<Record<string, string>>(() => ({ capital: "1000", risk: "1", entry: "", stop: "", ...(typeof window === "undefined" ? {} : readCalc()) }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...v, [k]: e.target.value };
    setV(next);
    try {
      localStorage.setItem(CALC_KEY, JSON.stringify(next));
    } catch {
      /* a convenience only */
    }
  };
  const num = (k: string) => Number(v[k]?.replace(",", "."));
  const entry = num("entry");
  const stop = num("stop");
  const ready = entry > 0 && stop > 0 && entry !== stop;
  const r = ready ? positionSize({ capital: num("capital"), riskPercent: num("risk"), entry, stop, side: stop < entry ? "long" : "short" }) : null;
  const ok = r && !("error" in r) ? r : null;
  useTone(onTone, ok ? { rgb: stop < entry ? UP : DOWN, strength: 0.5 } : { rgb: BLUE, strength: 0.4 });
  const field = (k: string, label: string) => (
    <label className="wg-input">
      <span>{label}</span>
      <input inputMode="decimal" value={v[k] ?? ""} onChange={set(k)} onClick={(e) => e.stopPropagation()} placeholder="—" />
    </label>
  );
  return (
    <>
      <Head kind="calculator" aside={ready ? (stop < entry ? m.widgets.long : m.widgets.short) : undefined} />
      <div className="wg-calc">
        {field("capital", c.capital)}
        {field("risk", c.risk)}
        {field("entry", c.entry)}
        {field("stop", c.stop)}
      </div>
      <div className="wg-facts">
        <div>
          <span className="wg-label">{c.size}</span>
          <span className="wg-fact">{ok ? ok.size.toLocaleString(numberTag(), { maximumFractionDigits: 6 }) : "—"}</span>
        </div>
        <div>
          <span className="wg-label">{c.notional}</span>
          <span className="wg-fact">{ok ? ok.notional.toLocaleString(numberTag(), { maximumFractionDigits: 2 }) : "—"}</span>
        </div>
        {size === "large" && (
          <>
            <div>
              <span className="wg-label">{c.leverage}</span>
              <span className="wg-fact">{ok ? `×${ok.leverage.toFixed(2)}` : "—"}</span>
            </div>
            <div>
              <span className="wg-label">{c.atRisk}</span>
              <span className="wg-fact is-down">{ok ? `${ok.riskAmount.toFixed(2)} · ${ok.stopDistancePct.toFixed(2)} %` : "—"}</span>
            </div>
          </>
        )}
      </div>
      {r && "error" in r && <p className="wg-foot is-down">{r.error}</p>}
    </>
  );
}
