"use client";

import type { CSSProperties, ReactNode } from "react";
import { STABLES, type Summary, type WalletSplit } from "@/lib/plugins/portfolio/aggregate";
import { PERIODS, performance, type Period } from "@/lib/plugins/portfolio/performance";
import { allocation } from "@/lib/plugins/portfolio/view-model";
import type { Candle } from "@/lib/plugins/shared/candle";
import { Segmented } from "@/components/ui/segmented";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { Donut, SplitBar, type Part } from "./charts";
import { accountKey } from "./side";

/* ---------------------------------------------------------------------------
   The right sheet of the Portfolio tab, as a wealth report: for the whole
   (or one account) — the value and its move over the period chosen
   (7D · 30D · 90D · 1Y); the performance: the value's curve, then the
   figures a report gives (return, high and low, max drawdown, best and
   worst day, annualized volatility), the daily returns drawn in the
   curve's own tile, each under its day; the allocation, full width, a
   donut and a bar per asset; the composition, three tiles side by side —
   cash (stablecoins) against crypto, the wallets (spot, futures,
   funding), the positions' exposure and PnL;
   for the whole, the accounts compared (one or many); and the positions —
   every asset held (spot) and every open futures position.

   An account's page holds the same report, from its own daily totals —
   filed under the account's settings id, never its name; its curve
   starts with its first snapshot (the testnet is never filed).
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
  /** Where the curve's past comes from, before the daily snapshots. */
  origin?: "ledger" | "mixed" | "estimate" | null;
};

const TONES = ["var(--alloc-0)", "var(--alloc-1)", "var(--alloc-2)", "var(--alloc-3)", "var(--alloc-4)", "var(--alloc-5)", "var(--alloc-6)"];
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} %`;
const toneOf = (v: number | undefined) => (v === undefined || v === 0 ? "is-flat" : v > 0 ? "is-up" : "is-down");
const dayOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function Dashboard({ summary, account, series, period, onPeriod, value, perUsd, currency, onScope, origin = null }: Props) {
  const whole = account === null;
  const perf = performance(series);
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
  const unpriced = account ? summary.unpriced.filter((u) => u.label === account.label) : summary.unpriced;
  /* What is held, as positions too: every asset but the stablecoins (cash,
     in the composition), with the accounts that hold it. */
  const holdings = assets
    .filter((a) => !STABLES.has(a.asset))
    .map((a) => ({
      ...a,
      tone: parts.find((x) => x.key === a.asset)?.tone ?? "var(--alloc-other)",
      accounts: account ? [{ label: account.label, testnet: account.testnet }] : summary.accounts.filter((x) => !x.testnet && x.assets.some((y) => y.asset === a.asset)).map((x) => ({ label: x.label, testnet: x.testnet })),
    }));

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
            <p className="pfv-hero-note">The move appears after two daily snapshots.</p>
          )}
        </div>
        <Segmented label="Period" value={period} options={PERIODS} onChange={onPeriod} />
      </div>

      <Part title="Performance" sub={origin === "ledger" ? "rebuilt from the exchange's ledger — trades, fees, deposits, withdrawals — at each day's price" : origin === "mixed" ? "rebuilt from the exchanges' ledgers; estimated from today's holdings where an exchange has none" : origin === "estimate" ? "estimated from today's holdings at past prices: this exchange gives no ledger" : whole ? "one snapshot of the total a day, while the app is open" : "one snapshot of this account a day, while the app is open"}>
          <div className="pfv-chart">
            <PriceChart candles={series} interval="1d" mode="line" fit returns message={series.length < 2 ? (whole ? "The curve appears after two daily snapshots." : account?.testnet ? "A testnet account is never recorded: no curve." : "This account's curve starts with its first daily snapshots.") : null} />
          </div>
          <div className="wlv-insights pfv-metrics" style={{ "--cols": 5 } as CSSProperties}>
            <Metric label="Return" value={perf ? signed(perf.pct) : "—"} tone={toneOf(perf?.pct)} sub={perf ? `${perf.change >= 0 ? "+" : "−"}${inCur(Math.abs(perf.change))}` : "—"} />
            <Metric label="High · Low" value={perf ? inCur(perf.high) : "—"} sub={perf ? `low ${inCur(perf.low)}` : "—"} />
            <Metric label="Max drawdown" value={perf ? signed(perf.maxDrawdown) : "—"} tone={perf && perf.maxDrawdown < 0 ? "is-down" : undefined} sub="deepest fall from a high" />
            <Metric label="Best · Worst day" value={perf?.best ? signed(perf.best.pct) : "—"} tone={perf?.best ? "is-up" : undefined} sub={perf?.worst ? `${signed(perf.worst.pct)} on ${dayOf(perf.worst.t)}` : "—"} />
            <Metric label="Volatility" value={perf?.volatility != null ? `${perf.volatility.toFixed(1)} %` : "—"} sub="annualized, daily moves" />
          </div>
      </Part>

      <Part title="Allocation" sub={whole ? "live accounts" : account?.label}>
        {assets.length === 0 ? (
          <p className="pfv-quiet">No balance to split.</p>
        ) : (
          <div className="pfv-allocation">
            <Donut parts={parts} center={`${assets.length}`} sub={assets.length === 1 ? "asset" : "assets"} />
            <ul className="pfv-legend">
              {slices.map((s, i) => (
                <li key={s.asset} style={{ "--tone": parts[i].tone, "--w": `${Math.max(s.share * 100, 0.5)}%` } as CSSProperties}>
                  <i />
                  <b>{s.asset}</b>
                  <span className="pfv-legend-bar" aria-hidden>
                    <u />
                  </span>
                  <span className="pfv-legend-value">
                    {value(s.usd)}
                    {s.amount !== undefined ? <small>{fmt(s.amount)}</small> : s.count ? <small>{s.count} assets</small> : null}
                  </span>
                  <em>{(s.share * 100).toFixed(1)} %</em>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Part>

      <Part title="Composition">
        <div className="pfv-compo">
          <div className="pfv-compo-cell">
            <span className="pfv-caption">Cash and crypto</span>
            <b className="pfv-compo-figure">{total > 0 ? `${(((total - cash) / total) * 100).toFixed(1)} %` : "—"}</b>
            <small className="pfv-compo-sub">in crypto · {value(cash)} in stablecoins</small>
            <SplitBar
              parts={[
                { key: "crypto", label: "Crypto", value: total - cash, tone: "var(--alloc-0)" },
                { key: "cash", label: "Stablecoins", value: cash, tone: "var(--alloc-2)" },
              ]}
              format={(p, share) => `${(share * 100).toFixed(1)} %`}
            />
          </div>
          <div className="pfv-compo-cell">
            <span className="pfv-caption">Wallets</span>
            <b className="pfv-compo-figure">{value(wallets.spot)}</b>
            <small className="pfv-compo-sub">in spot · {value(wallets.futures)} in futures</small>
            <SplitBar
              parts={[
                { key: "spot", label: "Spot", value: wallets.spot, tone: "var(--alloc-1)" },
                { key: "futures", label: "Futures", value: wallets.futures, tone: "var(--alloc-3)" },
                { key: "funding", label: "Funding", value: wallets.funding, tone: "var(--alloc-4)" },
              ]}
              format={(p, share) => `${(share * 100).toFixed(1)} %`}
            />
          </div>
          <div className="pfv-compo-cell">
            <span className="pfv-caption">Exposure of the open positions</span>
            {positions.length ? (
              <>
                <b className={`pfv-compo-figure ${toneOf(pnl)}`}>
                  {pnl >= 0 ? "+" : "−"}
                  {fmt(Math.abs(pnl), 2)} USDT
                </b>
                <small className="pfv-compo-sub">unrealized PnL · net {long - short >= 0 ? "long" : "short"} {fmt(Math.abs(long - short), 0)} USDT</small>
                <SplitBar
                  parts={[
                    { key: "long", label: "Long", value: long, tone: "var(--up)" },
                    { key: "short", label: "Short", value: short, tone: "var(--down)" },
                  ]}
                  format={(p) => `${fmt(p.value, 0)} USDT`}
                />
              </>
            ) : (
              <>
                <b className="pfv-compo-figure">—</b>
                <small className="pfv-compo-sub">no open position</small>
              </>
            )}
          </div>
        </div>
      </Part>

      {whole && summary.accounts.length > 0 && (
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

      <Part title="Positions" sub={holdings.length + positions.length ? `${holdings.length} held · ${positions.length} open` : undefined}>
        {holdings.length + positions.length === 0 ? (
          <p className="pfv-quiet">No asset held and no open position.</p>
        ) : (
          <div className="wlv-events">
            {holdings.map((h) => (
              <div key={`held:${h.asset}`} className="wlv-event pfv-position pfv-holding" style={{ "--tone": h.tone } as CSSProperties}>
                <span className="pfv-position-pair">
                  <b>{h.asset}</b>
                  <small className="pfv-side is-long">Spot</small>
                </span>
                <span className="pfv-position-account">
                  {h.accounts.map((a) => (
                    <span key={a.label} className="pfv-held-on">
                      <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                      {a.label}
                    </span>
                  ))}
                </span>
                <span className="pfv-position-figures">
                  <small>Amount</small> {fmt(h.amount)} <small>Price</small> {h.amount > 0 ? value(h.usd / h.amount) : "—"} <small>Share</small> {(h.share * 100).toFixed(1)} %
                </span>
                <span className="pfv-position-pnl pfv-held-value">{value(h.usd)}</span>
              </div>
            ))}
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
        )}
      </Part>

      {unpriced.length > 0 && (
        <Part title="Not counted" sub="no price available">
          <p className="pfv-quiet">{unpriced.map((u) => `${u.asset} ${fmt(u.amount)}${whole ? ` (${u.label})` : ""}`).join(" · ")}</p>
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
