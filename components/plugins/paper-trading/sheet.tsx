"use client";

import { useState, type ReactNode } from "react";
import { Close, Refresh } from "@/components/ui/icons";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { CASH, baseOf, dayOf, fillTitle, orderTitle, pct, price, signed, toneOf, usdt, whenOf, type PaperState } from "./format";

/* ---------------------------------------------------------------------------
   The right sheet, top to bottom: the portfolio's name and when it began;
   four figures as one block of tiles (cash, what is invested, realized,
   unrealized); the result over time — a curve like Stocks, from the fills;
   then what the portfolio holds, each thing a row with the one action it
   calls for: a holding can be sold, a position closed, an order cancelled.
   Last, the activity: every fill, newest first. A fresh portfolio shows
   its cash and one line on how to begin.
--------------------------------------------------------------------------- */

type Props = {
  data: PaperState | null;
  loading: boolean;
  problem: string | null;
  exportButton: ReactNode;
  exportResult: ReactNode;
  onReload: () => void;
  onReset: () => void;
  /** Runs one of the plugin's actions, then the data reloads. */
  onAct: (action: string, params: Record<string, unknown>) => Promise<string | null>;
};

const SHOWN_FILLS = 12;

export function Sheet({ data, loading, problem, exportButton, exportResult, onReload, onReset, onAct }: Props) {
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
          <h2 className="wlv-sheet-title">
            <span className="pv-ink">Paper portfolio</span>
          </h2>
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

        {empty ? (
          <section className="ptv-empty">
            <p className="ptv-empty-title">
              <span className="pv-ink">Ready when you are</span>
            </p>
            <p>Place a first order on the left, or ask an agent: “paper-buy 200 USDT of ETH”, “open a paper long on SOL at ×3”. Every order fills at the live price, with fees and slippage, as it would on an exchange.</p>
          </section>
        ) : (
          data && (
            <section className="wlv-chart-block ptv-chart" aria-label="Result over time">
              <div className="ptv-chart-bar">
                <span>Result</span>
                <small>closed trades, net of fees — today at market prices</small>
              </div>
              <PriceChart candles={curve?.candles ?? null} interval={curve?.interval ?? "1d"} mode="line" fit message={chartMessage} />
            </section>
          )
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
                    <span className="ptv-row-name">
                      <b>{h.asset}</b>
                      <small>
                        {fmt(h.amount)} · bought at {price(h.avgPrice)}
                      </small>
                    </span>
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
                    <span className="ptv-row-name">
                      <b>
                        {baseOf(p.symbol)} <em className={p.side === "long" ? "is-up" : "is-down"}>{p.side === "long" ? "Long" : "Short"}</em> ×{p.leverage}
                      </b>
                      <small>
                        {fmt(p.amount)} at {price(p.entryPrice)} · now {price(p.mark)}
                      </small>
                    </span>
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
                    <span className="ptv-row-name">
                      <b>{orderTitle(o)}</b>
                      <small>
                        {o.market === "futures" ? "Futures" : "Spot"} · placed {whenOf(o.createdAt)}
                      </small>
                    </span>
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
