"use client";

import { useState, type ReactNode } from "react";
import { Close, Pencil, Refresh } from "@/components/ui/icons";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import type { Valuation } from "@/lib/plugins/paper-trading/engine";
import type { Stats as StatsData } from "@/lib/plugins/paper-trading/stats";
import { CASH, baseOf, dayOf, fillTitle, orderTitle, pct, price, signed, toneOf, usdt, whenOf, type PaperState } from "./format";

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
};

const SHOWN_FILLS = 12;

export function Sheet({ data, loading, problem, many, tradeClosed, exportButton, exportResult, onReload, onReset, onDelete, onOpenTrade, onRename, onAct, market, onSymbol }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [allFills, setAllFills] = useState(false);
  const v = data?.valuation;
  const status = !data ? "Loading…" : `${loading ? "Updating" : "Updated"} ${new Date(data.at).toLocaleTimeString("en-GB")}`;

  const run = async (key: string, action: string, params: Record<string, unknown>) => {
    setBusy(key);
    await onAct(action, params);
    setBusy(null);
  };

  const empty = data && v && v.holdings.length === 0 && v.positions.length === 0 && data.orders.length === 0 && data.fills.length === 0;
  const invested = v ? v.holdings.reduce((t, h) => t + (h.value ?? 0), 0) + v.positions.reduce((t, p) => t + p.margin + (p.unrealized ?? 0), 0) : undefined;
  const curve = data?.curve;
  const chartMessage = !curve ? "Loading…" : curve.candles.length < 2 ? "The curve draws itself as the portfolio lives: come back after a few trades." : null;

  return (
    <main className="wlv-pane wlv-sheet ptv-sheet">
      <header className="wlv-head">
        <div className="wlv-title-block">
          {data ? (
            <NameTitle key={`${data.id}:${data.name}`} name={data.name} onRename={onRename} />
          ) : (
            <h2 className="wlv-sheet-title">
              <span className="pv-ink">Paper portfolio</span>
            </h2>
          )}
          <p className="wlv-sheet-sub">{data ? `Since ${dayOf(data.createdAt)}, with ${usdt(data.capital)} ${CASH} of paper money. Nothing here is real.` : "Reading the portfolio…"}</p>
        </div>
        <span className={`wlv-status${data && !loading && !problem ? " is-live" : ""}`}>{status}</span>
        <button type="button" className="wlv-icon" onClick={onReload} aria-label="Read the prices again" title="Read the prices again">
          <Refresh />
        </button>
        <span className="ptv-export">{exportButton}</span>
        <button type="button" className="ptv-pill" onClick={onReset} disabled={!data}>
          Reset
        </button>
        {many && (
          <button type="button" className="ptv-pill is-danger" onClick={onDelete} disabled={!data}>
            Delete
          </button>
        )}
        {tradeClosed && (
          <button type="button" className="ptv-pill is-primary" onClick={onOpenTrade}>
            Trade
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
            <Figure label="Cash" value={usdt(v.cash)} sub={`${usdt(data.available[CASH])} free to trade`} />
            <Figure label="Invested" value={usdt(invested)} sub={`${v.holdings.length} holding${v.holdings.length === 1 ? "" : "s"}, ${v.positions.length} position${v.positions.length === 1 ? "" : "s"}`} />
            <Figure label="Realized" value={signed(v.realized)} tone={toneOf(v.realized)} sub={`after ${usdt(v.fees)} of fees`} />
            <Figure label="Unrealized" value={signed(v.unrealized)} tone={toneOf(v.unrealized)} sub="on what is still open" />
          </div>
        )}

        {market}

        {data && data.fills.length > 0 && (
          <Section title="Performance" sub="closed trades, net of fees — today at market prices">
            <div className="ptv-perf-chart">
              <PriceChart candles={curve?.candles ?? null} interval={curve?.interval ?? "1d"} mode="line" fit message={chartMessage} />
            </div>
            <Stats stats={data.stats} />
          </Section>
        )}

        {v && (
          <Section title="Allocation" sub="where the capital is">
            <Allocation v={v} />
          </Section>
        )}

        {empty && (
          <section className="ptv-empty">
            <p className="ptv-empty-title">
              <span className="pv-ink">Ready when you are</span>
            </p>
            <p>Choose a pair and place a first order in the ticket, or ask an agent: “paper-buy 200 USDT of ETH”, “open a paper long on SOL at ×3”. Every order fills at the live price, with fees and slippage, as it would on an exchange.</p>
          </section>
        )}

        {v && v.holdings.length > 0 && data && (
          <Section title="Holdings" sub="spot">
            <ul className="ptv-rows">
              {v.holdings.map((h) => {
                const cost = h.amount * h.avgPrice;
                const move = h.unrealized !== undefined && cost > 0 ? (h.unrealized / cost) * 100 : undefined;
                const free = data.available[h.asset] ?? 0;
                return (
                  <li key={h.asset} className="ptv-row">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(`${h.asset}/${CASH}`)} title={`Show the ${h.asset} market`}>
                      <b>{h.asset}</b>
                      <small>
                        {fmt(h.amount)} · bought at {price(h.avgPrice)}
                      </small>
                    </button>
                    <span className="ptv-row-figure">
                      <b>{usdt(h.value)}</b>
                      <small className={toneOf(h.unrealized)}>{signed(h.unrealized)}</small>
                    </span>
                    <span className={`wlv-pill ptv-row-pill ${toneOf(move)}`}>{pct(move)}</span>
                    <button type="button" className="ptv-row-act" disabled={busy !== null || free <= 0} onClick={() => void run(`sell:${h.asset}`, "order", { symbol: `${h.asset}/${CASH}`, side: "sell", type: "market", market: "spot", amount: free })}>
                      {busy === `sell:${h.asset}` ? "Selling…" : "Sell all"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {v && v.positions.length > 0 && (
          <Section title="Positions" sub="futures, isolated margin">
            <ul className="ptv-rows">
              {v.positions.map((p) => {
                const roe = p.unrealized !== undefined && p.margin > 0 ? (p.unrealized / p.margin) * 100 : undefined;
                /* How far the price has gone from the entry toward the
                   liquidation: an empty track is safe, a full one is gone. */
                const toward = p.mark !== undefined ? Math.max(0, Math.min(1, (p.entryPrice - p.mark) / (p.entryPrice - p.liquidation))) : 0;
                const away = p.mark !== undefined ? (Math.abs(p.mark - p.liquidation) / p.mark) * 100 : undefined;
                return (
                  <li key={p.symbol} className="ptv-row ptv-row-position">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(p.symbol)} title={`Show the ${baseOf(p.symbol)} market`}>
                      <b>
                        {baseOf(p.symbol)} <em className={p.side === "long" ? "is-up" : "is-down"}>{p.side === "long" ? "Long" : "Short"}</em> ×{p.leverage}
                      </b>
                      <small>
                        {fmt(p.amount)} at {price(p.entryPrice)} · now {price(p.mark)}
                      </small>
                    </button>
                    <span className="ptv-row-figure">
                      <b className={toneOf(p.unrealized)}>{signed(p.unrealized)}</b>
                      <small>margin {usdt(p.margin)}</small>
                    </span>
                    <span className={`wlv-pill ptv-row-pill ${toneOf(roe)}`}>{pct(roe)}</span>
                    <button type="button" className="ptv-row-act" disabled={busy !== null} onClick={() => void run(`close:${p.symbol}`, "order", { symbol: p.symbol, side: p.side === "long" ? "sell" : "buy", type: "market", market: "futures", amount: p.amount, reduceOnly: true })}>
                      {busy === `close:${p.symbol}` ? "Closing…" : "Close"}
                    </button>
                    <span className="ptv-liq">
                      <span className="ptv-liq-track" aria-hidden>
                        <i style={{ width: `${toward * 100}%` }} />
                      </span>
                      <small>
                        Liquidation at {price(p.liquidation)}
                        {away !== undefined ? ` — ${away.toFixed(1)} % away` : ""}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {data && data.orders.length > 0 && (
          <Section title="Open orders" sub="waiting for their price">
            <ul className="ptv-rows">
              {data.orders.map((o) => {
                const m = data.prices[o.symbol];
                const gap = m !== undefined && o.price !== undefined ? ((o.price - m) / m) * 100 : undefined;
                return (
                  <li key={o.id} className="ptv-row ptv-row-order">
                    <button type="button" className="ptv-row-name ptv-row-pick" onClick={() => onSymbol(o.symbol)} title={`Show the ${baseOf(o.symbol)} market`}>
                      <b>{orderTitle(o)}</b>
                      <small>
                        {o.market === "futures" ? "Futures" : "Spot"} · placed {whenOf(o.createdAt)}
                      </small>
                    </button>
                    <span className="ptv-row-figure">
                      <b>{price(o.price)}</b>
                      <small>{gap !== undefined ? `${Math.abs(gap).toFixed(2)} % ${gap < 0 ? "below" : "above"} the market` : "limit"}</small>
                    </span>
                    <button type="button" className="wlv-icon ptv-cancel" disabled={busy !== null} onClick={() => void run(`cancel:${o.id}`, "cancel", { orderId: o.id })} aria-label={`Cancel: ${orderTitle(o)}`} title="Cancel the order">
                      <Close />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {data && data.fills.length > 0 && (
          <Section title="Activity" sub={`${data.fills.length === 100 ? "the last 100" : data.fills.length} fill${data.fills.length === 1 ? "" : "s"}`}>
            <ul className="ptv-rows ptv-activity">
              {(allFills ? data.fills : data.fills.slice(0, SHOWN_FILLS)).map((f) => (
                <li key={f.id} className={`ptv-row ptv-fill${f.liquidation ? " is-liquidation" : ""}`}>
                  <span className={`ptv-dot ${f.liquidation ? "is-down" : f.side === "buy" ? "is-up" : "is-down"}`} aria-hidden />
                  <span className="ptv-row-name">
                    <b>{fillTitle(f)}</b>
                    <small>
                      {whenOf(f.at)} · at {price(f.price)} · fee {usdt(f.fee)}
                    </small>
                  </span>
                  <span className={`ptv-fill-result ${toneOf(f.realizedPnl)}`}>{f.realizedPnl ? signed(f.realizedPnl) : ""}</span>
                </li>
              ))}
            </ul>
            {data.fills.length > SHOWN_FILLS && (
              <button type="button" className="ptv-more" onClick={() => setAllFills(!allFills)}>
                {allFills ? "Show fewer" : `Show all ${data.fills.length}`}
              </button>
            )}
          </Section>
        )}

        {data && <p className="ptv-foot">Prices from BytNode, or from your exchange for a pair BytNode does not cover. A paper result is a simulation, never a real performance.</p>}
      </div>
    </main>
  );
}

/** The portfolio's name — a click edits it, Enter or leaving the field
    keeps it, Escape leaves it as it was; a refused name says why. */
function NameTitle({ name, onRename }: { name: string; onRename: (name: string) => Promise<string | null> }) {
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
        <button type="button" className="ptv-name" onClick={() => setDraft(name)} title="Rename the portfolio">
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
        aria-label="Name of the portfolio"
        value={draft}
        maxLength={40}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void keep()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void keep();
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
  return (
    <div className="wlv-insights ptv-stats">
      <Figure label="Trades closed" value={String(stats.trades)} sub={`${stats.fills} fill${stats.fills === 1 ? "" : "s"} in all`} />
      <Figure label="Win rate" value={stats.winRate === undefined ? "—" : `${stats.winRate.toFixed(0)} %`} sub={stats.trades ? `${stats.wins} won, ${stats.trades - stats.wins} lost` : "no trade closed yet"} />
      <Figure label="Best trade" value={stats.best === undefined ? "—" : signed(stats.best)} tone={toneOf(stats.best)} sub={stats.avgWin === undefined ? "—" : `${signed(stats.avgWin)} on average`} />
      <Figure label="Worst trade" value={stats.worst === undefined ? "—" : signed(stats.worst)} tone={toneOf(stats.worst)} sub={stats.avgLoss === undefined ? "—" : `${signed(stats.avgLoss)} on average`} />
      <Figure label="Deepest drawdown" value={stats.maxDrawdown === undefined ? "—" : `${stats.maxDrawdown.toFixed(2)} %`} tone={stats.maxDrawdown ? "is-down" : undefined} sub="from a peak of the curve" />
      <Figure label="Volume traded" value={usdt(stats.volume)} sub={`${usdt(stats.fees)} of fees paid`} />
    </div>
  );
}

/* Apple's system colours, never green or red — those are a gain and a loss. */
const SHARE_COLORS = ["#0a84ff", "#bf5af2", "#ff9f0a", "#40c8e0", "#5e5ce6", "#ff375f", "#ffd60a", "#64d2ff"];

/** Where the capital is: cash, each holding, each position (its margin and
    its result), as one bar of shares and a legend. */
function Allocation({ v }: { v: Valuation }) {
  const parts = [
    { key: "cash", label: "Cash", sub: CASH, value: Math.max(0, v.cash) },
    ...v.holdings.map((h) => ({ key: `spot:${h.asset}`, label: h.asset, sub: "spot", value: Math.max(0, h.value ?? 0) })),
    ...v.positions.map((p) => ({ key: `fut:${p.symbol}`, label: baseOf(p.symbol), sub: `${p.side} ×${p.leverage}`, value: Math.max(0, p.margin + (p.unrealized ?? 0)) })),
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
            <span className="ptv-alloc-share">{total > 0 ? `${((x.value / total) * 100).toFixed(1)} %` : "—"}</span>
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
