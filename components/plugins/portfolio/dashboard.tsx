"use client";

import type { CSSProperties, ReactNode } from "react";
import { STABLES, type Summary, type WalletSplit } from "@/lib/plugins/portfolio/aggregate";
import { PERIODS, dailyReturns, performance, type Period } from "@/lib/plugins/portfolio/performance";
import { allocation } from "@/lib/plugins/portfolio/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import { Segmented } from "@/components/ui/segmented";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { Donut, ReturnBars, SplitBar, type Part } from "./charts";
import { accountKey } from "./side";

/* ---------------------------------------------------------------------------
   The right sheet of the Portfolio tab, as a wealth report: for the whole
   (or one account) — the value and its move over the period chosen
   (7D · 30D · 90D · 1Y); the performance: the value's curve, then the
   figures a report gives (return, high and low, max drawdown, best and
   worst day, annualized volatility) and the daily returns as bars; the
   allocation as a donut; the composition — cash (stablecoins) against
   crypto, the wallets (spot, futures, funding), the positions' exposure;
   for the whole, the accounts compared; and the open positions.

   The daily snapshots keep the whole portfolio, never an account (no
   account name is ever written): an account's page says so where the
   curve would be.
--------------------------------------------------------------------------- */

type Account = Summary["accounts"][number];

type Props = {
  summary: Summary;
  account: Account | null;
  series: Candle[];
  period: Period;
  onPeriod: (p: Period) => void;
  value: (usd: number) => string;
  perUsd: number;
  currency: string;
  onScope: (key: string) => void;
};

const TONES = ["var(--alloc-0)", "var(--alloc-1)", "var(--alloc-2)", "var(--alloc-3)", "var(--alloc-4)", "var(--alloc-5)", "var(--alloc-6)"];
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} %`;
const toneOf = (v: number | undefined) => (v === undefined || v === 0 ? "is-flat" : v > 0 ? "is-up" : "is-down");
const dayOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function Dashboard({ summary, account, series, period, onPeriod, value, perUsd, currency, onScope }: Props) {
  const whole = account === null;
  const perf = whole ? performance(series) : null;
  const assets = account ? account.assets : summary.assets;
  const wallets: WalletSplit = account ? account.wallets : summary.wallets;
  const positions = account ? summary.positions.filter((p) => p.label === account.label && p.testnet === account.testnet) : summary.positions.filter((p) => !p.testnet);
  const total = account ? account.usd : summary.totalUsd;
  const inCur = (native: number) => `${native.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  const slices = allocation(assets);
  const parts: Part[] = slices.map((s, i) => ({ key: s.asset, label: s.asset, value: s.usd, tone: s.asset === "Other" ? "var(--alloc-other)" : TONES[i] }));
  const cash = assets.filter((a) => STABLES.has(a.asset)).reduce((s, a) => s + a.usd, 0);
  const long = positions.filter((p) => !/short|sell/i.test(p.side)).reduce((s, p) => s + Math.abs(p.size * (p.mark ?? p.entry ?? 0)), 0);
  const short = positions.filter((p) => /short|sell/i.test(p.side)).reduce((s, p) => s + Math.abs(p.size * (p.mark ?? p.entry ?? 0)), 0);
  const pnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);

  return (
    <>
      {/* The value, and its move over the period. */}
      <div className="pfv-hero">
        <div>
          <p className="pfv-hero-value">
            <span>{(total * perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <small>{currency}</small>
          </p>
          {perf ? (
            <p className={`pfv-hero-move ${toneOf(perf.pct)}`}>
              {signed(perf.pct)}
              <span>
                {perf.change >= 0 ? "+" : "−"}
                {inCur(Math.abs(perf.change))} over {PERIODS.find((p) => p.value === period)?.label}
              </span>
            </p>
          ) : (
            <p className="pfv-hero-note">{whole ? "The move appears after two daily snapshots." : `${assets.length} asset${assets.length === 1 ? "" : "s"} · ${positions.length} open position${positions.length === 1 ? "" : "s"}`}</p>
          )}
        </div>
        {whole && <Segmented label="Period" value={period} options={PERIODS} onChange={onPeriod} />}
      </div>

      {whole ? (
        <Part title="Performance" sub="one snapshot of the total a day, while the app is open">
          <div className="pfv-chart">
            <PriceChart candles={series} interval="1d" mode="line" message={series.length < 2 ? "The curve appears after two daily snapshots." : null} />
          </div>
          <div className="wlv-insights pfv-metrics" style={{ "--cols": 5 } as CSSProperties}>
            <Metric label="Return" value={perf ? signed(perf.pct) : "—"} tone={toneOf(perf?.pct)} sub={perf ? `${perf.change >= 0 ? "+" : "−"}${inCur(Math.abs(perf.change))}` : "—"} />
            <Metric label="High · Low" value={perf ? inCur(perf.high) : "—"} sub={perf ? `low ${inCur(perf.low)}` : "—"} />
            <Metric label="Max drawdown" value={perf ? signed(perf.maxDrawdown) : "—"} tone={perf && perf.maxDrawdown < 0 ? "is-down" : undefined} sub="deepest fall from a high" />
            <Metric label="Best · Worst day" value={perf?.best ? signed(perf.best.pct) : "—"} tone={perf?.best ? "is-up" : undefined} sub={perf?.worst ? `${signed(perf.worst.pct)} on ${dayOf(perf.worst.t)}` : "—"} />
            <Metric label="Volatility" value={perf?.volatility != null ? `${perf.volatility.toFixed(1)} %` : "—"} sub="annualized, daily moves" />
          </div>
          <div className="pfv-returns-block">
            <span className="pfv-caption">Daily returns</span>
            <ReturnBars moves={dailyReturns(series)} label={(m) => `${dayOf(m.t)}: ${signed(m.pct)}`} />
          </div>
        </Part>
      ) : (
        <p className="pfv-quiet pfv-account-note">The daily snapshots keep the whole portfolio, not each account: the curve and the returns are on “All portfolios”.</p>
      )}

      <div className="pfv-columns">
        <Part title="Allocation" sub={whole ? "live accounts" : account?.label}>
          {assets.length === 0 ? (
            <p className="pfv-quiet">No balance to split.</p>
          ) : (
            <div className="pfv-allocation">
              <Donut parts={parts} center={`${assets.length}`} sub={assets.length === 1 ? "asset" : "assets"} />
              <ul className="pfv-legend">
                {slices.map((s, i) => (
                  <li key={s.asset} style={{ "--tone": parts[i].tone } as CSSProperties}>
                    <i />
                    <b>{s.asset}</b>
                    <span>{value(s.usd)}</span>
                    <em>{(s.share * 100).toFixed(1)} %</em>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Part>

        <Part title="Composition">
          <div className="pfv-compo">
            <span className="pfv-caption">Cash and crypto</span>
            <SplitBar
              parts={[
                { key: "crypto", label: "Crypto", value: total - cash, tone: "var(--alloc-0)" },
                { key: "cash", label: "Stablecoins", value: cash, tone: "var(--alloc-2)" },
              ]}
              format={(p, share) => `${(share * 100).toFixed(1)} % · ${value(p.value)}`}
            />
            <span className="pfv-caption">Wallets</span>
            <SplitBar
              parts={[
                { key: "spot", label: "Spot", value: wallets.spot, tone: "var(--alloc-1)" },
                { key: "futures", label: "Futures", value: wallets.futures, tone: "var(--alloc-3)" },
                { key: "funding", label: "Funding", value: wallets.funding, tone: "var(--alloc-4)" },
              ]}
              format={(p, share) => `${(share * 100).toFixed(1)} %`}
            />
            <span className="pfv-caption">Exposure of the open positions</span>
            {positions.length ? (
              <SplitBar
                parts={[
                  { key: "long", label: "Long", value: long, tone: "var(--up)" },
                  { key: "short", label: "Short", value: short, tone: "var(--down)" },
                ]}
                format={(p) => `${fmt(p.value, 0)} USDT`}
              />
            ) : (
              <p className="pfv-quiet">No open position.</p>
            )}
            {positions.length > 0 && (
              <p className={`pfv-pnl ${toneOf(pnl)}`}>
                Unrealized PnL <b>{pnl >= 0 ? "+" : "−"}{fmt(Math.abs(pnl), 2)} USDT</b>
              </p>
            )}
          </div>
        </Part>
      </div>

      {whole && summary.accounts.length > 1 && (
        <Part title="Accounts" sub="compared">
          <div className="pfv-bars">
            {summary.accounts.map((a) => {
              const share = !a.testnet && summary.totalUsd > 0 ? a.usd / summary.totalUsd : 0;
              return (
                <button key={accountKey(a)} type="button" className="pfv-bar-row" onClick={() => onScope(accountKey(a))} title={`See ${a.label} on its own`}>
                  <span className="pfv-bar-name">
                    <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                    {a.label}
                  </span>
                  <span className="pfv-bar-track">
                    <i style={{ "--w": `${a.testnet ? 0 : Math.max(share * 100, a.usd > 0 ? 1 : 0)}%` } as CSSProperties} />
                  </span>
                  <span className="pfv-bar-value">
                    {value(a.usd)}
                    <small>{a.testnet ? "not counted" : `${(share * 100).toFixed(1)} %`}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </Part>
      )}

      {positions.length > 0 && (
        <Part title="Open positions" sub={`${positions.length}`}>
          <div className="wlv-events">
            {positions.map((p) => (
              <div key={`${p.label}:${p.symbol}:${p.side}`} className={`wlv-event pfv-position ${typeof p.pnl === "number" && p.pnl < 0 ? "is-down" : "is-up"}`}>
                <span className="pfv-position-pair">
                  <b>{p.symbol}</b>
                  <small className={`pfv-side ${/short|sell/i.test(p.side) ? "is-short" : "is-long"}`}>{p.side}</small>
                  {p.leverage ? <small>×{p.leverage}</small> : null}
                </span>
                <span className="pfv-position-account">
                  <span className={`xch-badge${p.testnet ? "" : " is-live"}`}>{p.testnet ? "TESTNET" : "LIVE"}</span>
                  {p.label}
                </span>
                <span className="pfv-position-figures">
                  <small>Size</small> {fmt(p.size)} <small>Entry</small> {fmt(p.entry)} <small>Mark</small> {fmt(p.mark)}
                  {p.liquidation ? (
                    <>
                      {" "}
                      <small>Liq.</small> {fmt(p.liquidation)}
                    </>
                  ) : null}
                </span>
                <span className="pfv-position-pnl">{typeof p.pnl === "number" ? `${p.pnl >= 0 ? "+" : "−"}${fmt(Math.abs(p.pnl))}` : "—"}</span>
              </div>
            ))}
          </div>
        </Part>
      )}

      {whole && summary.unpriced.length > 0 && (
        <Part title="Not counted" sub="no price available">
          <p className="pfv-quiet">{summary.unpriced.map((u) => `${u.asset} ${fmt(u.amount)} (${u.label})`).join(" · ")}</p>
        </Part>
      )}
    </>
  );
}

/** A titled part of the report. */
function Part({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="pfv-part" aria-label={title}>
      <p className="pfv-part-title">
        <span className="pv-ink">{title}</span>
        {sub && <small>{sub}</small>}
      </p>
      {children}
    </section>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="wlv-insight pfv-metric">
      <span className="wlv-insight-label">{label}</span>
      <span className={`wlv-insight-value ${tone ?? ""}`}>{value}</span>
      <span className="wlv-insight-sub">{sub}</span>
    </div>
  );
}
