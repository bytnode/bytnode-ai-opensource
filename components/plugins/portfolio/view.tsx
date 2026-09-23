"use client";

import { useState } from "react";
import type { Snapshot, Summary } from "@/lib/plugins/portfolio/aggregate";
import type { Money } from "@/lib/plugins/portfolio/present";
import { CURRENCIES } from "@/lib/plugins/shared/fx";
import { pluginManifest } from "@/lib/plugins/catalog";
import { pluginSettings, resolveConfig } from "@/lib/plugins/core/state";
import { goToSettings } from "@/lib/state/navigation";
import { Select } from "@/components/ui/select";
import type { ViewProps } from "../views";
import { usePluginData } from "../use-plugin-data";
import { useOnWake } from "../view-activity";
import { useReportExport } from "../use-report-export";
import { Change, Kpi, Loading, Problem, Sparkline, fmt, money } from "../bits";

/* ---------------------------------------------------------------------------
   The Portfolio tab: every account at once — the total, its evolution, the
   split by asset and by account, the open positions — in the currency
   chosen, and an export as a dated report in the active agent's
   workspace.
--------------------------------------------------------------------------- */

type Current = { summary: Summary; money: Money; at: string };

export function PortfolioView({ settings }: ViewProps) {
  const configured = String(resolveConfig(pluginManifest("portfolio")!, pluginSettings(settings.plugins, "portfolio").config).currency);
  const [currency, setCurrency] = useState(configured);
  const { data, error, loading, reload } = usePluginData<Current>("portfolio", "summary", settings, { currency });
  useOnWake(reload);
  const history = usePluginData<{ points: Snapshot[] }>("portfolio", "history", settings, { days: 90 });
  const report = useReportExport("portfolio", settings, { currency });

  if (settings.keys.exchanges.length === 0) {
    return (
      <div className="notice pv-error">
        <p>No exchange account yet: the portfolio reads the accounts you add in Settings → Auth.</p>
        <button type="button" className="btn btn-sm" onClick={() => goToSettings({ tab: "auth" })}>
          Add an account
        </button>
      </div>
    );
  }

  const s = data?.summary;
  const m = data?.money;
  const inCur = (usd: number | undefined) => (m && typeof usd === "number" ? money(usd * m.perUsd, m.currency) : "—");
  const points = history.data?.points ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const delta = first && last && first.totalUsd > 0 ? ((last.totalUsd - first.totalUsd) / first.totalUsd) * 100 : undefined;

  return (
    <>
      <div className="pv-toolbar">
        <div className="pv-toolbar-field">
          <Select id="pf-currency" label="Currency" value={currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={setCurrency} />
        </div>
        {loading && data && <span className="pv-chip">Updating…</span>}
        <span className="tb-space" />
        {report.button(!s)}
      </div>
      {report.result}
      {error && <Problem message={error} />}
      {!s || !m ? (
        <Loading />
      ) : (
        <>
          <div className="pv-kpis">
            <Kpi label="Total, live accounts" value={inCur(s.totalUsd)} sub={m.rateNote || `read ${new Date(data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />
            <Kpi label="Over 90 days" value={<Change pct={delta} />} sub={first ? `since ${first.date}` : "no snapshot yet"} />
            <Kpi label="Unrealized PnL" value={s.positions.length ? inCur(s.unrealizedPnl) : "—"} sub={`${s.positions.length} open position${s.positions.length === 1 ? "" : "s"}`} />
            {s.testnetUsd > 0 && <Kpi label="Testnet (not counted)" value={inCur(s.testnetUsd)} />}
          </div>

          {points.length > 1 && (
            <section className="pv-section">
              <h2 className="pv-section-title">Evolution</h2>
              <Sparkline points={points.map((p) => ({ t: Date.parse(p.at), v: p.totalUsd * m.perUsd }))} />
              <p className="pv-note">One snapshot a day, while the app is open.</p>
            </section>
          )}

          <section className="pv-section">
            <h2 className="pv-section-title">By asset</h2>
            {s.assets.length === 0 ? (
              <p className="pv-note">No balance on the live accounts.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th className="num">Amount</th>
                      <th className="num">Value</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.assets.map((a) => (
                      <tr key={a.asset}>
                        <td>
                          <strong>{a.asset}</strong>
                        </td>
                        <td className="num">{fmt(a.amount)}</td>
                        <td className="num">{inCur(a.usd)}</td>
                        <td className="pv-share">
                          <div className="pv-bar">
                            <span style={{ width: `${(a.share * 100).toFixed(1)}%` }} />
                          </div>
                          <span className="pv-muted">{(a.share * 100).toFixed(1)} %</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pv-section">
            <h2 className="pv-section-title">By account</h2>
            <div className="pv-table-wrap">
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Exchange</th>
                    <th className="num">Value</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {s.accounts.map((a) => (
                    <tr key={a.label}>
                      <td>
                        <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                        {a.label}
                      </td>
                      <td className="pv-muted">{a.exchange}</td>
                      <td className="num">{inCur(a.usd)}</td>
                      <td className={a.error ? "pv-down" : "pv-muted"}>{a.error ?? (a.unpriced ? `${a.unpriced} unpriced asset(s)` : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {s.positions.length > 0 && (
            <section className="pv-section">
              <h2 className="pv-section-title">Open positions</h2>
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Pair</th>
                      <th>Side</th>
                      <th className="num">Size</th>
                      <th className="num">Entry</th>
                      <th className="num">Mark</th>
                      <th className="num">PnL</th>
                      <th className="num">Liquidation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.positions.map((p) => (
                      <tr key={`${p.label}:${p.symbol}`}>
                        <td>{p.label}</td>
                        <td>{p.symbol}</td>
                        <td>{p.side}</td>
                        <td className="num">{fmt(p.size)}</td>
                        <td className="num">{fmt(p.entry)}</td>
                        <td className="num">{fmt(p.mark)}</td>
                        <td className={`num ${typeof p.pnl === "number" && p.pnl < 0 ? "pv-down" : "pv-up"}`}>{fmt(p.pnl)}</td>
                        <td className="num">{fmt(p.liquidation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {s.unpriced.length > 0 && (
            <p className="pv-note">
              Not counted, no price available: {s.unpriced.map((u) => `${u.asset} ${fmt(u.amount)} (${u.label})`).join(", ")}.
            </p>
          )}
        </>
      )}
    </>
  );
}
