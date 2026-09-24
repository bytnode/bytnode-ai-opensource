"use client";

import type { CSSProperties, ReactNode } from "react";
import { STABLES, type Summary, type WalletSplit } from "@/lib/plugins/portfolio/aggregate";
import { PERIODS, performance, type Period } from "@/lib/plugins/portfolio/performance";
import type { Activity, Coverage } from "@/lib/plugins/portfolio/backfill";
import type { Access } from "@/lib/plugins/portfolio/permissions";
import { exchangeInfo } from "@/lib/tools/exchange/catalog";
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
  /** What the exchanges said: trades, deposits, withdrawals (null: not
      asked — the sample), and how far back each kind reached. */
  activity?: Activity[] | null;
  coverage?: Record<string, Record<string, Coverage>> | null;
  /** The history is being read from the exchanges. */
  reading?: boolean;
  /** Per account id, what its API key cannot read (only the accounts
      that lack something). */
  access?: Record<string, Access> | null;
};

const KINDS: Array<{ key: string; label: string }> = [
  { key: "ledger", label: "Ledger" },
  { key: "trades", label: "Trades" },
  { key: "deposits", label: "Deposits" },
  { key: "withdrawals", label: "Withdrawals" },
  { key: "earn", label: "Earn" },
  { key: "converts", label: "Converts" },
];
const ACT = { buy: "Bought", sell: "Sold", deposit: "Deposit", withdrawal: "Withdrawal", outflow: "Left the account", inflow: "Came in" } as const;
const ACT_TONE = { buy: "var(--alloc-0)", sell: "var(--alloc-3)", deposit: "var(--up)", withdrawal: "var(--down)", outflow: "var(--cal-unlock)", inflow: "var(--up)" } as const;

const TONES = ["var(--alloc-0)", "var(--alloc-1)", "var(--alloc-2)", "var(--alloc-3)", "var(--alloc-4)", "var(--alloc-5)", "var(--alloc-6)"];
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} %`;
const toneOf = (v: number | undefined) => (v === undefined || v === 0 ? "is-flat" : v > 0 ? "is-up" : "is-down");
const dayOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function Dashboard({ summary, account, series, period, onPeriod, value, perUsd, currency, onScope, origin = null, activity = null, coverage = null, reading = false, access = null }: Props) {
  const whole = account === null;
  const perf = performance(series);
  const assets = account ? account.assets : summary.assets;
  const wallets: WalletSplit = account ? account.wallets : summary.wallets;
  const positions = account ? summary.positions.filter((p) => p.label === account.label && p.testnet === account.testnet) : summary.positions.filter((p) => !p.testnet);
  const total = account ? account.usd : summary.totalUsd;
  const inCur = (native: number) => `${native.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const money = (native: number) => `${native >= 0 ? "+" : "−"}${inCur(Math.abs(native))}`;
  /* A figure without its currency, where the cell's value already says it. */
  const bare = (native: number) => native.toLocaleString("en-US", { maximumFractionDigits: native >= 1000 ? 0 : 2 });

  const slices = allocation(assets);
  const parts: Part[] = slices.map((s, i) => ({ key: s.asset, label: s.asset, value: s.usd, tone: s.asset === "Other" ? "var(--alloc-other)" : TONES[i] }));
  const cash = assets.filter((a) => STABLES.has(a.asset)).reduce((s, a) => s + a.usd, 0);
  const long = positions.filter((p) => !/short|sell/i.test(p.side)).reduce((s, p) => s + Math.abs(p.size * (p.mark ?? p.entry ?? 0)), 0);
  const short = positions.filter((p) => /short|sell/i.test(p.side)).reduce((s, p) => s + Math.abs(p.size * (p.mark ?? p.entry ?? 0)), 0);
  const pnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const unpriced = account ? summary.unpriced.filter((u) => u.label === account.label) : summary.unpriced;
  /* The activity of what is shown, over the period on screen. */
  const periodStart = series[0]?.t ?? 0;
  const labelOf = new Map(summary.accounts.filter((a) => a.id).map((a) => [a.id as string, a]));
  const acts = (activity ?? []).filter((a) => (account ? a.account === account.id : true) && a.t >= periodStart);
  const count = (k: Activity["kind"]) => acts.filter((a) => a.kind === k).length;
  const covered = coverage ? Object.entries(coverage).filter(([id]) => (account ? id === account.id : true)) : [];
  const lacking = access ? Object.entries(access).filter(([id, a]) => a.missing.length > 0 && (account ? id === account.id : true)) : [];
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
      {/* The value, and its performance over the period — one line, the
          move as the watchlist writes it. */}
      <div className="pfv-hero">
        <p className="pfv-hero-value">
          <span>{(total * perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <small>{currency}</small>
        </p>
        {perf ? (
          <p className="pfv-hero-move">
            <b className="wlv-pill" style={{ "--tone": perf.pct > 0 ? "var(--up)" : perf.pct < 0 ? "var(--down)" : "var(--label-3)" } as CSSProperties}>
              {signed(perf.pct)}
            </b>
            <span>
              {money(perf.change)} gained over {PERIODS.find((p) => p.value === period)?.label}
            </span>
          </p>
        ) : (
          <p className="pfv-hero-note">The move appears after two daily snapshots.</p>
        )}
        <Segmented label="Period" value={period} options={PERIODS} onChange={onPeriod} />
      </div>

      <Part title="Performance" sub={origin === "ledger" ? "from the exchanges' records, at each day's close" : origin === "mixed" ? "from the exchanges' records, estimated where one has none" : origin === "estimate" ? "estimated from today's holdings at past prices" : "a daily snapshot, while the app is open"}>
          {lacking.map(([id, a]) => {
            const name = exchangeInfo(a.exchange)?.label ?? a.exchange;
            const label = labelOf.get(id)?.label;
            return (
              <div key={id} className="pfv-access" role="alert">
                <p className="pfv-access-title">
                  {name}
                  {label ? ` · ${label}` : ""}: the API key cannot read the whole account
                </p>
                <p>
                  Not ticked on the key:{" "}
                  {a.missing.map((m, i) => (
                    <span key={m.key}>
                      <b>{m.label}</b>
                      {i < a.missing.length - 1 ? ", " : ""}
                    </span>
                  ))}
                  . The history below leaves out {a.missing.map((m) => m.what).join("; ")} — it shows {a.shown}.
                </p>
                <p className="pfv-access-foot">
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      Open {name}&apos;s API keys
                    </a>
                  )}
                  <span>Read access is enough; never tick Withdrawal. Then reload the portfolio.</span>
                </p>
              </div>
            );
          })}
          <div className="pfv-chart">
            <PriceChart candles={series} interval="1d" mode="line" fit returns message={series.length < 2 ? (whole ? "The curve appears after two daily snapshots." : account?.testnet ? "A testnet account is never recorded: no curve." : "This account's curve starts with its first daily snapshots.") : null} />
          </div>
          <div className="wlv-insights pfv-metrics" style={{ "--cols": 5 } as CSSProperties}>
            <Metric label="Return" value={perf ? signed(perf.pct) : "—"} tone={toneOf(perf?.pct)} sub={perf ? `${money(perf.change)} gained` : "—"} />
            <Metric label="Value change" value={perf ? money(perf.valueChange) : "—"} tone={toneOf(perf?.valueChange)} sub={perf ? `from ${bare(perf.start)} to ${bare(perf.end)}` : "—"} />
            <Metric label="Money moved" value={perf ? money(perf.moneyIn + perf.moneyOut) : "—"} sub={!perf ? "—" : perf.moneyIn || perf.moneyOut ? `${bare(perf.moneyIn)} in · ${bare(Math.abs(perf.moneyOut))} out` : "no deposit nor withdrawal"} />
            <Metric label="High" value={perf ? inCur(perf.high) : "—"} sub={perf ? `on ${dayOf(perf.highAt)}` : "—"} />
            <Metric label="Low" value={perf ? inCur(perf.low) : "—"} sub={perf ? `on ${dayOf(perf.lowAt)}` : "—"} />
            <Metric label="Max drawdown" value={perf ? signed(perf.maxDrawdown) : "—"} tone={perf && perf.maxDrawdown < 0 ? "is-down" : undefined} sub="of the performance" />
            <Metric label="Deepest value fall" value={perf ? signed(perf.valueDrawdown) : "—"} tone={perf && perf.valueDrawdown < 0 ? "is-down" : undefined} sub="money taken out included" />
            <Metric label="Best day" value={perf?.best ? signed(perf.best.pct) : "—"} tone={perf?.best && perf.best.pct > 0 ? "is-up" : undefined} sub={perf?.best ? `on ${dayOf(perf.best.t)}` : "—"} />
            <Metric label="Worst day" value={perf?.worst ? signed(perf.worst.pct) : "—"} tone={perf?.worst && perf.worst.pct < 0 ? "is-down" : undefined} sub={perf?.worst ? `on ${dayOf(perf.worst.t)}` : "—"} />
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
                { key: "earn", label: "Earn", value: wallets.earn, tone: "var(--alloc-2)" },
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

      {activity !== null && (
        <Part title="Activity" sub={reading ? "reading the exchanges' history…" : `${PERIODS.find((p) => p.value === period)?.label} · ${count("buy") + count("sell")} trades · ${count("deposit")} deposits · ${count("withdrawal")} withdrawals`}>
          {acts.length === 0 ? (
            <p className="pfv-quiet">{reading ? "Reading the trades, deposits and withdrawals…" : "No trade, deposit or withdrawal in this period."}</p>
          ) : (
            <div className="wlv-events">
              {acts.slice(0, 14).map((a, i) => (
                <div key={`${a.t}:${a.kind}:${a.asset}:${i}`} className="wlv-event pfv-act" style={{ "--tone": ACT_TONE[a.kind] } as CSSProperties}>
                  <span className="pfv-act-when">{new Date(a.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="pfv-act-what">
                    <b>{ACT[a.kind]}</b> {fmt(a.amount)} {a.asset}
                    {a.price ? <small> at {fmt(a.price)}</small> : null}
                    {a.kind === "outflow" ? <small> · a card payment, a P2P sale or Bybit Pay: the API does not show which</small> : null}
                  </span>
                  <span className="pfv-position-account">{labelOf.get(a.account)?.label ?? ""}</span>
                </div>
              ))}
              {acts.length > 14 && <p className="pfv-quiet pfv-act-more">and {acts.length - 14} more in this period</p>}
            </div>
          )}
        </Part>
      )}

      {coverage !== null && covered.length > 0 && (
        <Part title="History" sub="what each exchange keeps, and since when">
          <div className="pfv-cover">
            {covered.map(([id, kinds]) => {
              const a = labelOf.get(id);
              return (
                <div key={id} className="pfv-cover-row">
                  <span className="pfv-bar-name">
                    <span className={`xch-badge${a?.testnet ? "" : " is-live"}`}>{a?.testnet ? "TESTNET" : "LIVE"}</span>
                    {a?.label ?? id}
                  </span>
                  <span className="pfv-cover-chips">
                    {KINDS.map((k) => {
                      const c = kinds[k.key];
                      if (!c) return null;
                      const since = c.from ? new Date(c.from).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
                      const text = c.status === "ok" ? (since ? `since ${since}` : "read") : c.status === "limited" ? (since ? `only since ${since}` : "limited by the exchange") : c.status === "unsupported" ? "not offered" : "could not be read";
                      return (
                        <span key={k.key} className={`pfv-chip is-${c.status}`} title={c.note ?? ""}>
                          <b>{k.label}</b> {text}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
          {covered.some(([, kinds]) => Object.values(kinds).some((c) => c.status === "limited")) && (
            <p className="pfv-quiet pfv-cover-note">An exchange that keeps a shorter history than the period asked is marked in orange: its figures start where its history does.</p>
          )}
        </Part>
      )}

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
