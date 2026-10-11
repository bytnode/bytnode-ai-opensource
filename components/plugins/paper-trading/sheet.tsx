"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Close, Pencil, Refresh } from "@/components/ui/icons";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import type { Valuation } from "@/lib/plugins/paper-trading/engine";
import type { Stats as StatsData } from "@/lib/plugins/paper-trading/stats";
import { CASH, baseOf, dayOf, fillTitle, focusSymbol, orderTitle, pct, price, signed, toneOf, usdt, whenOf, type Focus, type PaperState } from "./format";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   The middle sheet, the chosen portfolio top to bottom: its name (a click
   renames it) and when it began; four figures as one block of tiles
   (cash, what is invested, realized, unrealized); the market of the pair
   in the ticket (`market.tsx`); its performance — the result curve, from
   the fills, and six figures of its record; where its capital is, as one
   bar of shares; then what it holds, each thing a row with the one action
   it calls for (a holding sold, a position closed, an order cancelled) and
   whose name shows its market. Last, the activity: every fill, newest
   first. A fresh portfolio says how to begin.

   With a `focus` (a position or a holding picked in the left column), the
   sheet shows that one alone instead (`Detail`): its figures, how close
   its liquidation is, its market, its orders and its fills, and the one
   action it calls for.
--------------------------------------------------------------------------- */

type Props = {
  data: PaperState | null;
  loading: boolean;
  problem: string | null;
  /** Whether there are other portfolios: only then can this one be deleted. */
  many: boolean;
  /** The ticket's column is closed: the head offers to open it again. */
  tradeClosed: boolean;
  exportButton: ReactNode;
  exportResult: ReactNode;
  onReload: () => void;
  onReset: () => void;
  onDelete: () => void;
  onOpenTrade: () => void;
  /** Renames the portfolio; answers why not, or null. */
  onRename: (name: string) => Promise<string | null>;
  /** Runs one of the plugin's actions on this portfolio, then the data reloads. */
  onAct: (action: string, params: Record<string, unknown>) => Promise<string | null>;
  /** The market block (`market.tsx`), under the figures. */
  market: ReactNode;
  /** A row's pair becomes the ticket's (and the market block's). */
  onSymbol: (symbol: string) => void;
  /** The position or holding shown alone, if one is. */
  focus: Focus | null;
  /** Back to the whole portfolio. */
  onUnfocus: () => void;
};

const SHOWN_FILLS = 12;

export function Sheet({ data, loading, problem, many, tradeClosed, exportButton, exportResult, onReload, onReset, onDelete, onOpenTrade, onRename, onAct, market, onSymbol, focus, onUnfocus }: Props) {
  const m = useMessages();
  const t = m.paperTrading.sheet;
  const [busy, setBusy] = useState<string | null>(null);
  const [allFills, setAllFills] = useState(false);
  const v = data?.valuation;
  const time = data ? new Date(data.at).toLocaleTimeString(dateTag()) : "";
  const status = !data ? m.common.loading : loading ? t.updating(time) : t.updated(time);

  const run = async (key: string, action: string, params: Record<string, unknown>) => {
    setBusy(key);
    await onAct(action, params);
    setBusy(null);
  };

  const empty = data && v && v.holdings.length === 0 && v.positions.length === 0 && data.orders.length === 0 && data.fills.length === 0;
  const invested = v ? v.holdings.reduce((t, h) => t + (h.value ?? 0), 0) + v.positions.reduce((t, p) => t + p.margin + (p.unrealized ?? 0), 0) : undefined;
  const curve = data?.curve;
  const chartMessage = !curve ? m.common.loading : curve.candles.length < 2 ? t.curveSoon : null;

  if (data && focus) {
    return <Detail data={data} focus={focus} status={status} live={!loading && !problem} problem={problem} busy={busy} tradeClosed={tradeClosed} market={market} onBack={onUnfocus} onReload={onReload} onOpenTrade={onOpenTrade} onRun={run} />;
  }

  return (
    <main className="wlv-pane wlv-sheet ptv-sheet">
      <header className="wlv-head">
        <div className="wlv-title-block">
          {data ? (
            <NameTitle key={`${data.id}:${data.name}`} name={data.name} onRename={onRename} />
          ) : (
            <h2 className="wlv-sheet-title">
              <span className="pv-ink">{t.portfolio}</span>
            </h2>
          )}
          <p className="wlv-sheet-sub">{data ? t.since(dayOf(data.createdAt), `${usdt(data.capital)} ${CASH}`) : t.reading}</p>
        </div>
        <span className={`wlv-status${data && !loading && !problem ? " is-live" : ""}`}>{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} aria-label={m.paperTrading.readAgain} title={m.paperTrading.readAgain}>
          <Refresh />
        </button>
        <span className="ptv-export">{exportButton}</span>
        <button type="button" className="ptv-pill" onClick={onReset} disabled={!data}>
          {t.reset}
        </button>
        {many && (
          <button type="button" className="ptv-pill is-danger" onClick={onDelete} disabled={!data}>
            {m.common.delete}
          </button>
        )}
        {tradeClosed && (
          <button type="button" className="ptv-pill is-primary" onClick={onOpenTrade}>
            {m.paperTrading.trade}
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}
      {data?.priceErrors.map((m) => (
        <p key={m} className="wlv-problem">
          {m}
        </p>
      ))}
      <div className="ptv-report">{exportResult}</div>

      <div className="wlv-body">
        {v && data && (
          <div className="wlv-insights ptv-figures">
            <Figure label={t.cash} value={usdt(v.cash)} sub={t.freeToTrade(usdt(data.available[CASH]))} />
            <Figure label={t.invested} value={usdt(invested)} sub={t.investedSub(v.holdings.length, v.positions.length)} />
            <Figure label={t.realized} value={signed(v.realized)} tone={toneOf(v.realized)} sub={t.afterFees(usdt(v.fees))} />
            <Figure label={t.unrealized} value={signed(v.unrealized)} tone={toneOf(v.unrealized)} sub={t.stillOpen} />
          </div>
        )}

        {market}

        {data && data.fills.length > 0 && (
          <Section title={t.performance} sub={t.performanceSub}>
            <div className="ptv-perf-chart">
              <PriceChart candles={curve?.candles ?? null} interval={curve?.interval ?? "1d"} mode="line" fit message={chartMessage} />
            </div>
            <Stats stats={data.stats} />
          </Section>
        )}

        {v && (
          <Section title={t.allocation} sub={t.allocationSub}>
            <Allocation v={v} />
          </Section>
        )}

        {empty && (
          <section className="ptv-empty">
            <p className="ptv-empty-title">
              <span className="pv-ink">{t.emptyTitle}</span>
            </p>
            <p>{t.emptyBody}</p>
          </section>
        )}

        {v && v.holdings.length > 0 && data && (
          <Section title={t.holdings} sub={t.spotSub}>
            <ul className="ptv-rows">
              {v.holdings.map((h) => {
                const cost = h.amount * h.avgPrice;
                const move = h.unrealized !== undefined && cost > 0 ? (h.unrealized / cost) * 100 : undefined;
                const free = data.available[h.asset] ?? 0;
                return (
                  <li key={h.asset} className="ptv-row">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(`${h.asset}/${CASH}`)} title={t.showMarket(h.asset)}>
                      <b>{h.asset}</b>
                      <small>{t.boughtAt(fmt(h.amount), price(h.avgPrice))}</small>
                    </button>
                    <span className="ptv-row-figure">
                      <b>{usdt(h.value)}</b>
                      <small className={toneOf(h.unrealized)}>{signed(h.unrealized)}</small>
                    </span>
                    <span className={`wlv-pill ptv-row-pill ${toneOf(move)}`}>{pct(move)}</span>
                    <button type="button" className="ptv-row-act" disabled={busy !== null || free <= 0} onClick={() => void run(`sell:${h.asset}`, "order", { symbol: `${h.asset}/${CASH}`, side: "sell", type: "market", market: "spot", amount: free })}>
                      {busy === `sell:${h.asset}` ? t.selling : t.sellAll}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {v && v.positions.length > 0 && (
          <Section title={t.positions} sub={t.positionsSub}>
            <ul className="ptv-rows">
              {v.positions.map((p) => {
                const roe = p.unrealized !== undefined && p.margin > 0 ? (p.unrealized / p.margin) * 100 : undefined;
                /* How far the price has gone from the entry toward the
                   liquidation: an empty track is safe, a full one is gone. */
                const toward = p.mark !== undefined ? Math.max(0, Math.min(1, (p.entryPrice - p.mark) / (p.entryPrice - p.liquidation))) : 0;
                const away = p.mark !== undefined ? (Math.abs(p.mark - p.liquidation) / p.mark) * 100 : undefined;
                return (
                  <li key={p.symbol} className="ptv-row ptv-row-position">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(p.symbol)} title={t.showMarket(baseOf(p.symbol))}>
                      <b>
                        {baseOf(p.symbol)} <em className={p.side === "long" ? "is-up" : "is-down"}>{p.side === "long" ? m.paperTrading.long : m.paperTrading.short}</em> ×{p.leverage}
                      </b>
                      <small>{t.entryNow(fmt(p.amount), price(p.entryPrice), price(p.mark))}</small>
                    </button>
                    <span className="ptv-row-figure">
                      <b className={toneOf(p.unrealized)}>{signed(p.unrealized)}</b>
                      <small>{t.marginOf(usdt(p.margin))}</small>
                    </span>
                    <span className={`wlv-pill ptv-row-pill ${toneOf(roe)}`}>{pct(roe)}</span>
                    <button type="button" className="ptv-row-act" disabled={busy !== null} onClick={() => void run(`close:${p.symbol}`, "order", { symbol: p.symbol, side: p.side === "long" ? "sell" : "buy", type: "market", market: "futures", amount: p.amount, reduceOnly: true })}>
                      {busy === `close:${p.symbol}` ? t.closing : t.close}
                    </button>
                    <span className="ptv-liq">
                      <span className="ptv-liq-track" aria-hidden>
                        <i style={{ width: `${toward * 100}%` }} />
                      </span>
                      <small>{t.liquidationAt(price(p.liquidation), away !== undefined ? `${fmt(away, 1)} %` : null)}</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {data && data.orders.length > 0 && (
          <Section title={t.openOrders} sub={t.waitingForPrice}>
            <ul className="ptv-rows">
              {data.orders.map((o) => {
                const mark = data.prices[o.symbol];
                const gap = mark !== undefined && o.price !== undefined ? ((o.price - mark) / mark) * 100 : undefined;
                return (
                  <li key={o.id} className="ptv-row ptv-row-order">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(o.symbol)} title={t.showMarket(baseOf(o.symbol))}>
                      <b>{orderTitle(o)}</b>
                      <small>
                        {o.market === "futures" ? m.paperTrading.futures : m.paperTrading.spot} · {t.placed(whenOf(o.createdAt))}
                      </small>
                    </button>
                    <span className="ptv-row-figure">
                      <b>{price(o.price)}</b>
                      <small>{gap !== undefined ? t.gap(`${fmt(Math.abs(gap), 2)} %`, gap < 0) : t.limit}</small>
                    </span>
                    <button type="button" className="wlv-icon ptv-cancel" disabled={busy !== null} onClick={() => void run(`cancel:${o.id}`, "cancel", { orderId: o.id })} aria-label={t.cancelLabel(orderTitle(o))} title={t.cancelTitle}>
                      <Close />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {data && data.fills.length > 0 && (
          <Section title={t.activity} sub={t.fills(data.fills.length)}>
            <ul className="ptv-rows ptv-activity">
              {(allFills ? data.fills : data.fills.slice(0, SHOWN_FILLS)).map((f) => (
                <li key={f.id} className={`ptv-row ptv-fill${f.liquidation ? " is-liquidation" : ""}`}>
                  <span className={`ptv-dot ${f.liquidation ? "is-down" : f.side === "buy" ? "is-up" : "is-down"}`} aria-hidden />
                  <span className="ptv-row-name">
                    <b>{fillTitle(f)}</b>
                    <small>{t.fillLine(whenOf(f.at), price(f.price), usdt(f.fee))}</small>
                  </span>
                  <span className={`ptv-fill-result ${toneOf(f.realizedPnl)}`}>{f.realizedPnl ? signed(f.realizedPnl) : ""}</span>
                </li>
              ))}
            </ul>
            {data.fills.length > SHOWN_FILLS && (
              <button type="button" className="ptv-more" onClick={() => setAllFills(!allFills)}>
                {allFills ? t.showFewer : t.showAll(data.fills.length)}
              </button>
            )}
          </Section>
        )}

        {data && <p className="ptv-foot">{t.foot}</p>}
      </div>
    </main>
  );
}

/* --- One position, or one holding, alone ----------------------------------- */

type DetailProps = {
  data: PaperState;
  focus: Focus;
  status: string;
  live: boolean;
  problem: string | null;
  busy: string | null;
  tradeClosed: boolean;
  market: ReactNode;
  onBack: () => void;
  onReload: () => void;
  onOpenTrade: () => void;
  onRun: (key: string, action: string, params: Record<string, unknown>) => Promise<void>;
};

/** The sheet of a single position or holding: a way back to the whole
    portfolio, its name as the title, six figures as one block of tiles,
    for a position its road to the liquidation, then its market, its open
    orders and its fills — with its one action in the head. */
function Detail({ data, focus, status, live, problem, busy, tradeClosed, market, onBack, onReload, onOpenTrade, onRun }: DetailProps) {
  const m = useMessages();
  const t = m.paperTrading.sheet;
  const v = data.valuation;
  const symbol = focusSymbol(focus);
  const futures = focus.kind === "position";
  const orders = data.orders.filter((o) => o.symbol === symbol && (o.market === "futures") === futures);
  const fills = data.fills.filter((f) => f.symbol === symbol && (f.market === "futures") === futures);
  const p = focus.kind === "position" ? v.positions.find((x) => x.symbol === focus.symbol) : undefined;
  const h = focus.kind === "holding" ? v.holdings.find((x) => x.asset === focus.asset) : undefined;
  if (!p && !h) return null;

  let title: ReactNode = null;
  let sub = "";
  let action: ReactNode = null;
  let figures: ReactNode = null;
  let extra: ReactNode = null;
  if (p) {
    const roe = p.unrealized !== undefined && p.margin > 0 ? (p.unrealized / p.margin) * 100 : undefined;
    const move = p.mark !== undefined ? ((p.mark - p.entryPrice) / p.entryPrice) * 100 : undefined;
    const toward = p.mark !== undefined ? Math.max(0, Math.min(1, (p.entryPrice - p.mark) / (p.entryPrice - p.liquidation))) : 0;
    const away = p.mark !== undefined ? (Math.abs(p.mark - p.liquidation) / p.mark) * 100 : undefined;
    title = (
      <>
        <span className="pv-ink">{baseOf(p.symbol)}</span> <em className={`ptv-detail-side ${p.side === "long" ? "is-up" : "is-down"}`}>{p.side === "long" ? m.paperTrading.long : m.paperTrading.short}</em> <span className="ptv-detail-lev">×{p.leverage}</span>
      </>
    );
    sub = t.positionSub(p.symbol, whenOf(p.openedAt));
    action = (
      <button type="button" className="ptv-pill is-danger" disabled={busy !== null} onClick={() => void onRun(`close:${p.symbol}`, "order", { symbol: p.symbol, side: p.side === "long" ? "sell" : "buy", type: "market", market: "futures", amount: p.amount, reduceOnly: true })}>
        {busy === `close:${p.symbol}` ? t.closing : t.closePosition}
      </button>
    );
    figures = (
      <>
        <Figure label={t.unrealized} value={signed(p.unrealized)} tone={toneOf(p.unrealized)} sub={t.onMargin(pct(roe))} />
        <Figure label={t.size} value={`${fmt(p.amount)} ${baseOf(p.symbol)}`} sub={t.atMark(`${usdt(p.mark !== undefined ? p.amount * p.mark : undefined)} ${CASH}`)} />
        <Figure label={t.margin} value={usdt(p.margin)} sub={t.isolated(p.leverage)} />
        <Figure label={t.entryPrice} value={price(p.entryPrice)} sub={t.opened(whenOf(p.openedAt))} />
        <Figure label={t.markPrice} value={price(p.mark)} tone={toneOf(move === undefined ? undefined : p.side === "long" ? move : -move)} sub={move === undefined ? t.noPriceYet : t.sinceEntry(pct(move))} />
        <Figure label={t.liquidation} value={price(p.liquidation)} tone="is-down" sub={away === undefined ? "—" : t.away(`${fmt(away, 1)} %`)} />
      </>
    );
    extra = (
      <Section title={t.liquidation} sub={t.liquidationSub}>
        <div className="ptv-detail-liq">
          <span className="ptv-liq-track" aria-hidden>
            <i style={{ width: `${toward * 100}%` }} />
          </span>
          <small>{t.road(price(p.entryPrice), price(p.mark), price(p.liquidation))}</small>
        </div>
      </Section>
    );
  } else if (h) {
    const cost = h.amount * h.avgPrice;
    const move = h.unrealized !== undefined && cost > 0 ? (h.unrealized / cost) * 100 : undefined;
    const free = data.available[h.asset] ?? 0;
    title = (
      <>
        <span className="pv-ink">{h.asset}</span> <em className="ptv-detail-side">{m.paperTrading.spot}</em>
      </>
    );
    sub = t.holdingSub(`${h.asset}/${CASH}`);
    action = (
      <button type="button" className="ptv-pill is-danger" disabled={busy !== null || free <= 0} onClick={() => void onRun(`sell:${h.asset}`, "order", { symbol: `${h.asset}/${CASH}`, side: "sell", type: "market", market: "spot", amount: free })}>
        {busy === `sell:${h.asset}` ? t.selling : t.sellAll}
      </button>
    );
    figures = (
      <>
        <Figure label={t.value} value={usdt(h.value)} sub={t.atMarket(CASH)} />
        <Figure label={t.unrealized} value={signed(h.unrealized)} tone={toneOf(h.unrealized)} sub={t.onCost(pct(move))} />
        <Figure label={t.amount} value={`${fmt(h.amount)} ${h.asset}`} sub={t.freeToSell(fmt(free))} />
        <Figure label={t.avgPrice} value={price(h.avgPrice)} sub={t.avgPriceSub} />
        <Figure label={t.priceNow} value={price(h.price)} tone={toneOf(move)} sub={pct(move)} />
        <Figure label={t.costBasis} value={usdt(cost)} sub={t.putIn(CASH)} />
      </>
    );
  }

  return (
    <main className="wlv-pane wlv-sheet ptv-sheet ptv-detail">
      <header className="wlv-head">
        <div className="wlv-title-block">
          <button type="button" className="ptv-back" onClick={onBack}>
            <ArrowLeft />
            {data.name}
          </button>
          <h2 className="wlv-sheet-title">{title}</h2>
          <p className="wlv-sheet-sub">{sub}</p>
        </div>
        <span className={`wlv-status${live ? " is-live" : ""}`}>{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} aria-label={m.paperTrading.readAgain} title={m.paperTrading.readAgain}>
          <Refresh />
        </button>
        {action}
        {tradeClosed && (
          <button type="button" className="ptv-pill is-primary" onClick={onOpenTrade}>
            {m.paperTrading.trade}
          </button>
        )}
      </header>
      {problem && <p className="wlv-problem">{problem}</p>}

      <div className="wlv-body">
        <div className="wlv-insights ptv-detail-figures">{figures}</div>

        {extra}

        {market}

        {orders.length > 0 && (
          <Section title={t.openOrders} sub={t.onThisPair}>
            <ul className="ptv-rows">
              {orders.map((o) => {
                const mark = data.prices[o.symbol];
                const gap = mark !== undefined && o.price !== undefined ? ((o.price - mark) / mark) * 100 : undefined;
                return (
                  <li key={o.id} className="ptv-row ptv-row-order">
                    <span className="ptv-row-name">
                      <b>{orderTitle(o)}</b>
                      <small>{t.placed(whenOf(o.createdAt))}</small>
                    </span>
                    <span className="ptv-row-figure">
                      <b>{price(o.price)}</b>
                      <small>{gap !== undefined ? t.gap(`${fmt(Math.abs(gap), 2)} %`, gap < 0) : t.limit}</small>
                    </span>
                    <button type="button" className="wlv-icon ptv-cancel" disabled={busy !== null} onClick={() => void onRun(`cancel:${o.id}`, "cancel", { orderId: o.id })} aria-label={t.cancelLabel(orderTitle(o))} title={t.cancelTitle}>
                      <Close />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <Section title={t.activity} sub={t.fillsOnPair(fills.length)}>
          {fills.length > 0 && (
            <ul className="ptv-rows ptv-activity">
              {fills.map((f) => (
                <li key={f.id} className={`ptv-row ptv-fill${f.liquidation ? " is-liquidation" : ""}`}>
                  <span className={`ptv-dot ${f.liquidation ? "is-down" : f.side === "buy" ? "is-up" : "is-down"}`} aria-hidden />
                  <span className="ptv-row-name">
                    <b>{fillTitle(f)}</b>
                    <small>{t.fillLine(whenOf(f.at), price(f.price), usdt(f.fee))}</small>
                  </span>
                  <span className={`ptv-fill-result ${toneOf(f.realizedPnl)}`}>{f.realizedPnl ? signed(f.realizedPnl) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </main>
  );
}

/** The portfolio's name — a click edits it, Enter or leaving the field
    keeps it, Escape leaves it as it was; a refused name says why. */
function NameTitle({ name, onRename }: { name: string; onRename: (name: string) => Promise<string | null> }) {
  const m = useMessages();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const keep = async () => {
    if (draft === null) return;
    if (draft.trim() === name || !draft.trim()) {
      setDraft(null);
      setProblem(null);
      return;
    }
    const p = await onRename(draft);
    setProblem(p);
    if (!p) setDraft(null);
  };
  if (draft === null) {
    return (
      <h2 className="wlv-sheet-title">
        <button type="button" className="ptv-name" onClick={() => setDraft(name)} title={m.paperTrading.sheet.rename}>
          <span className="pv-ink">{name}</span>
          <Pencil />
        </button>
      </h2>
    );
  }
  return (
    <div className="ptv-name-edit">
      <input
        className="wlv-input"
        aria-label={m.paperTrading.sheet.nameLabel}
        value={draft}
        maxLength={40}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void keep()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) void keep();
          if (e.key === "Escape") {
            setDraft(null);
            setProblem(null);
          }
        }}
      />
      {problem && <p className="wlv-problem">{problem}</p>}
    </div>
  );
}

/** The record: six figures as one block of tiles. */
function Stats({ stats }: { stats: StatsData }) {
  const m = useMessages();
  const t = m.paperTrading.sheet;
  return (
    <div className="wlv-insights ptv-stats">
      <Figure label={t.tradesClosed} value={String(stats.trades)} sub={t.fillsInAll(stats.fills)} />
      <Figure label={t.winRate} value={stats.winRate === undefined ? "—" : `${fmt(stats.winRate, 0)} %`} sub={stats.trades ? t.wonLost(stats.wins, stats.trades - stats.wins) : t.noTradeClosed} />
      <Figure label={t.bestTrade} value={stats.best === undefined ? "—" : signed(stats.best)} tone={toneOf(stats.best)} sub={stats.avgWin === undefined ? "—" : t.onAverage(signed(stats.avgWin))} />
      <Figure label={t.worstTrade} value={stats.worst === undefined ? "—" : signed(stats.worst)} tone={toneOf(stats.worst)} sub={stats.avgLoss === undefined ? "—" : t.onAverage(signed(stats.avgLoss))} />
      <Figure label={t.drawdown} value={stats.maxDrawdown === undefined ? "—" : `${fmt(stats.maxDrawdown, 2)} %`} tone={stats.maxDrawdown ? "is-down" : undefined} sub={t.fromPeak} />
      <Figure label={t.volume} value={usdt(stats.volume)} sub={t.feesPaid(usdt(stats.fees))} />
    </div>
  );
}

/* Apple's system colours, never green or red — those are a gain and a loss. */
const SHARE_COLORS = ["#0a84ff", "#bf5af2", "#ff9f0a", "#40c8e0", "#5e5ce6", "#ff375f", "#ffd60a", "#64d2ff"];

/** Where the capital is: cash, each holding, each position (its margin and
    its result), as one bar of shares and a legend. */
function Allocation({ v }: { v: Valuation }) {
  const m = useMessages();
  const t = m.paperTrading.sheet;
  const parts = [
    { key: "cash", label: t.cash, sub: CASH, value: Math.max(0, v.cash) },
    ...v.holdings.map((h) => ({ key: `spot:${h.asset}`, label: h.asset, sub: t.spotSub, value: Math.max(0, h.value ?? 0) })),
    ...v.positions.map((p) => ({ key: `fut:${p.symbol}`, label: baseOf(p.symbol), sub: t.allocSide(p.side, p.leverage), value: Math.max(0, p.margin + (p.unrealized ?? 0)) })),
  ];
  const total = parts.reduce((t, x) => t + x.value, 0);
  const colorOf = (i: number) => (i === 0 ? "var(--label-3)" : SHARE_COLORS[(i - 1) % SHARE_COLORS.length]);
  return (
    <div className="ptv-alloc">
      <div className="ptv-alloc-bar" aria-hidden>
        {parts.map((x, i) => (x.value > 0 ? <i key={x.key} style={{ flexGrow: x.value, background: colorOf(i) }} /> : null))}
      </div>
      <ul className="ptv-alloc-legend">
        {parts.map((x, i) => (
          <li key={x.key}>
            <span className="ptv-alloc-dot" style={{ background: colorOf(i) }} />
            <b>{x.label}</b>
            <small>{x.sub}</small>
            <span className="ptv-alloc-value">{usdt(x.value)}</span>
            <span className="ptv-alloc-share">{total > 0 ? `${fmt((x.value / total) * 100, 1)} %` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

function Figure({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="wlv-insight">
      <span className="wlv-insight-label">{label}</span>
      <span className={`wlv-insight-value${tone ? ` ${tone}` : ""}`}>{value}</span>
      <span className="wlv-insight-sub">{sub}</span>
    </div>
  );
}
