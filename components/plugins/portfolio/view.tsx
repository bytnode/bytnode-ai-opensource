"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { Snapshot, Summary } from "@/lib/plugins/portfolio/aggregate";
import type { Money } from "@/lib/plugins/portfolio/present";
import { allocation, dailySeries } from "@/lib/plugins/portfolio/view-model";
import { pluginManifest } from "@/lib/plugins/catalog";
import { pluginSettings, resolveConfig } from "@/lib/plugins/core/state";
import { goToSettings } from "@/lib/state/navigation";
import { PORTFOLIO_DEFAULT, PORTFOLIO_MAX, PORTFOLIO_MIN, clampPortfolioWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { Refresh } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { useReportExport } from "../use-report-export";
import { fmt } from "../bits";
import { PriceChart } from "../watchlist/price-chart";
import { Section } from "../watchlist/sheet";
import { Tile } from "../watchlist/insights";
import { pct } from "../watchlist/format";
import { Side } from "./side";
import "../watchlist/watchlist.css";
import "./portfolio.css";

/* ---------------------------------------------------------------------------
   The Portfolio tab, in the language of the calendar and the watchlist
   (it wears the watchlist's sheet, `../watchlist/watchlist.css`, plus its
   own pieces, `./portfolio.css`): the accounts and the currency on the
   left, a light veil; on the right, one sheet — the total, live, and its
   key figures as one row of tiles; its evolution, drawn like an asset's
   price; its split by asset as one block (a bar, then tiles in each
   asset's colour); the open positions, drawn like the calendar's blocks.

   Every open tab stays mounted: the summary is read again every two
   minutes while in front (it asks every exchange), and at once when the
   tab comes back. Testnet money is shown, never added to the total.
--------------------------------------------------------------------------- */

type Current = { summary: Summary; money: Money; at: string };

const REFRESH = 120_000;

export function PortfolioView({ settings }: ViewProps) {
  const configured = String(resolveConfig(pluginManifest("portfolio")!, pluginSettings(settings.plugins, "portfolio").config).currency);
  const [currency, setCurrency] = useState(configured);
  const { data, error, loading, reload } = usePluginData<Current>("portfolio", "summary", settings, { currency });
  useAwakeInterval(reload, REFRESH);
  const history = usePluginData<{ points: Snapshot[] }>("portfolio", "history", settings, { days: 90 });
  useAwakeInterval(history.reload, REFRESH * 5);
  const report = useReportExport("portfolio", settings, { currency });
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);

  const noAccount = settings.keys.exchanges.length === 0;
  const s = data?.summary ?? null;
  const m = data?.money ?? null;
  const inCur = (usd: number | undefined) => (m && typeof usd === "number" ? `${(usd * m.perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}` : "—");
  const points = history.data?.points ?? [];
  const series = m ? dailySeries(points, m.perUsd) : [];
  const first = points[0];
  const last = points[points.length - 1];
  const delta = first && last && first.totalUsd > 0 ? ((last.totalUsd - first.totalUsd) / first.totalUsd) * 100 : undefined;
  const live = s?.accounts.filter((a) => !a.testnet).length ?? 0;
  const test = s?.accounts.filter((a) => a.testnet).length ?? 0;
  const status = noAccount ? "" : loading ? "Updating…" : data ? `Updated ${new Date(data.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : noAccount ? "" : "Reading your accounts…";

  return (
    <div className="wlv pfv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.portfolioWidth}px` } as CSSProperties}>
        <Side summary={noAccount ? null : s} currency={currency} onCurrency={setCurrency} value={inCur} exportButton={noAccount ? null : report.button(!s)} exportResult={report.result} />
        <ColumnHandle
          panel={panel}
          cssVar="--wlv-list"
          width={ui.portfolioWidth}
          min={PORTFOLIO_MIN}
          max={PORTFOLIO_MAX}
          reset={PORTFOLIO_DEFAULT}
          clamp={clampPortfolioWidth}
          onCommit={(w) => updateUiPrefs({ portfolioWidth: w })}
          label="Width of the accounts"
        />
        <main className="wlv-pane wlv-sheet">
          <header className="wlv-head">
            <div className="wlv-title-block">
              <h2 className="wlv-sheet-title">
                <span className="pv-ink">{noAccount ? "No account yet" : "All accounts"}</span>
              </h2>
              <p className="wlv-sheet-sub">
                {noAccount ? "The portfolio reads the exchange accounts you add in Settings → Auth." : s ? `${live} live account${live === 1 ? "" : "s"}${test ? ` · ${test} testnet, not counted` : ""}` : "Reading the balances of every wallet…"}
              </p>
            </div>
            {status && <span className="wlv-status">{status}</span>}
            {!noAccount && (
              <button type="button" className="wlv-icon" onClick={reload} disabled={loading} aria-label="Read the accounts again" title="Read the accounts again">
                <Refresh />
              </button>
            )}
          </header>
          {error && <p className="wlv-problem">{error}</p>}
          <div className="wlv-body">
            {noAccount ? (
              <div className="pfv-empty">
                <button type="button" className="pfv-cta" onClick={() => goToSettings({ tab: "auth" })}>
                  Add an exchange account
                </button>
              </div>
            ) : (
              s &&
              m && (
                <>
                  <div className="wlv-figures">
                    <div className="wlv-hero">
                      <p className="wlv-price">
                        <span className="wlv-price-value">{(s.totalUsd * m.perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="wlv-price-unit">{m.currency}</span>
                        {delta !== undefined && (
                          <span className={`wlv-move ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : "is-flat"}`}>
                            {pct(delta)}
                            <small>since {first?.date}</small>
                          </span>
                        )}
                      </p>
                      <p className="wlv-source">{m.rateNote || "Every wallet of the live accounts — spot, futures, funding — valued with BytNode's prices, else the exchange's."}</p>
                    </div>
                    <div className="wlv-insights pfv-kpis" style={{ "--cols": 3 } as CSSProperties}>
                      <Tile label="Unrealized PnL" value={s.positions.length ? inCur(s.unrealizedPnl) : "—"} tone={!s.positions.length || s.unrealizedPnl === 0 ? undefined : s.unrealizedPnl > 0 ? "is-up" : "is-down"}>
                        <span className="wlv-insight-sub">
                          {s.positions.length} open position{s.positions.length === 1 ? "" : "s"}
                        </span>
                      </Tile>
                      <Tile label="Assets" value={String(s.assets.length)}>
                        <span className="wlv-insight-sub">{s.unpriced.length ? `${s.unpriced.length} unpriced` : "all priced"}</span>
                      </Tile>
                      <Tile label="Testnet" value={s.testnetUsd > 0 ? inCur(s.testnetUsd) : "—"}>
                        <span className="wlv-insight-sub">not counted</span>
                      </Tile>
                    </div>
                  </div>

                  <Section title="Evolution" sub="one snapshot a day, while the app is open">
                    <div className="wlv-chart-block pfv-chart">
                      <PriceChart candles={series} interval="1d" mode="line" message={series.length < 2 ? "The evolution appears after two daily snapshots." : null} />
                    </div>
                  </Section>

                  <Section title="Allocation" sub="live accounts">
                    {s.assets.length === 0 ? (
                      <p className="wlv-insight-message">No balance on the live accounts.</p>
                    ) : (
                      <Allocation summary={s} value={inCur} />
                    )}
                  </Section>

                  {s.positions.length > 0 && (
                    <Section title="Open positions" sub={`${s.positions.length}`}>
                      <div className="wlv-events">
                        {s.positions.map((p) => (
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
                    </Section>
                  )}

                  {s.unpriced.length > 0 && (
                    <Section title="Not counted" sub="no price available">
                      <p className="wlv-insight-message">{s.unpriced.map((u) => `${u.asset} ${fmt(u.amount)} (${u.label})`).join(" · ")}</p>
                    </Section>
                  )}
                </>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The split by asset: one bar of shares, then a tile per asset in its
    colour — the largest six, the rest as "Other". */
function Allocation({ summary, value }: { summary: Summary; value: (usd: number) => string }) {
  const slices = allocation(summary.assets);
  const tone = (i: number, asset: string) => (asset === "Other" ? "var(--alloc-other)" : `var(--alloc-${i})`);
  return (
    <>
      <div className="pfv-bar" role="img" aria-label={slices.map((x) => `${x.asset} ${(x.share * 100).toFixed(1)} %`).join(", ")}>
        {slices.map((x, i) => (
          <i key={x.asset} style={{ flexGrow: Math.max(x.share, 0.004), "--tone": tone(i, x.asset) } as CSSProperties} />
        ))}
      </div>
      <div className="wlv-insights pfv-assets" style={{ "--cols": 4 } as CSSProperties}>
        {slices.map((x, i) => (
          <div key={x.asset} className="wlv-insight pfv-asset" style={{ "--tone": tone(i, x.asset) } as CSSProperties}>
            <span className="wlv-insight-label">
              <i className="pfv-dot" />
              {x.asset}
            </span>
            <span className="wlv-insight-value">{(x.share * 100).toFixed(1)} %</span>
            <span className="wlv-insight-sub">
              {value(x.usd)}
              {x.amount !== undefined ? ` · ${fmt(x.amount)}` : x.count ? ` · ${x.count} assets` : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
