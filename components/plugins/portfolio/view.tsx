"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { Snapshot, Summary } from "@/lib/plugins/portfolio/aggregate";
import { performance, slicePeriod, type Period } from "@/lib/plugins/portfolio/performance";
import type { Money } from "@/lib/plugins/portfolio/present";
import { dailySeries } from "@/lib/plugins/portfolio/view-model";
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
import { Dashboard } from "./dashboard";
import { ALL, Side, accountKey } from "./side";
import "../watchlist/watchlist.css";
import "./portfolio.css";

/* ---------------------------------------------------------------------------
   The Portfolio tab, as a wealth report in the calendar's language (the
   veil and the sheet are the bare views', worn through the watchlist's
   sheet, `../watchlist/watchlist.css`; the report is `./portfolio.css`).
   Left, a navigator: the currency beside the tab's name, "All portfolios"
   — the whole — and each account, to see it on its own. Right, the report
   for what is chosen (`./dashboard.tsx`).

   Every open tab stays mounted: the summary is read again every two
   minutes while in front (it asks every exchange), and at once when the
   tab comes back. Testnet money is shown, never added to the total.
--------------------------------------------------------------------------- */

type Current = { summary: Summary; money: Money; at: string };

const REFRESH = 120_000;
/** A year of daily snapshots: the longest period offered. */
const HISTORY_DAYS = 366;

export function PortfolioView({ settings }: ViewProps) {
  const configured = String(resolveConfig(pluginManifest("portfolio")!, pluginSettings(settings.plugins, "portfolio").config).currency);
  const [currency, setCurrency] = useState(configured);
  const [scope, setScope] = useState(ALL);
  const [period, setPeriod] = useState<Period>("30d");
  const { data, error, loading, reload } = usePluginData<Current>("portfolio", "summary", settings, { currency });
  useAwakeInterval(reload, REFRESH);
  const history = usePluginData<{ points: Snapshot[] }>("portfolio", "history", settings, { days: HISTORY_DAYS });
  useAwakeInterval(history.reload, REFRESH * 5);
  const report = useReportExport("portfolio", settings, { currency });
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);

  const noAccount = settings.keys.exchanges.length === 0;
  const s = noAccount ? null : (data?.summary ?? null);
  const m = data?.money ?? null;
  const value = (usd: number | undefined) => (m && typeof usd === "number" ? `${(usd * m.perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}` : "—");
  /* An account that is no longer there sends back to the whole. */
  const account = s && scope !== ALL ? (s.accounts.find((a) => accountKey(a) === scope) ?? null) : null;
  const series = m ? slicePeriod(dailySeries(history.data?.points ?? [], m.perUsd), period) : [];
  const perf = performance(series);
  const move = perf ? { text: `${perf.pct >= 0 ? "+" : "−"}${Math.abs(perf.pct).toFixed(2)} %`, tone: perf.pct > 0 ? "is-up" : perf.pct < 0 ? "is-down" : "is-flat" } : null;
  const status = noAccount ? "" : loading ? "Updating…" : data ? `Updated ${new Date(data.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Reading your accounts…";

  return (
    <div className="wlv pfv">
      <div className="wlv-panel" ref={panel} style={{ "--wlv-list": `${ui.portfolioWidth}px` } as CSSProperties}>
        <Side summary={s} scope={account ? scope : ALL} onScope={setScope} currency={currency} onCurrency={setCurrency} value={value} move={move} />
        <ColumnHandle
          panel={panel}
          cssVar="--wlv-list"
          width={ui.portfolioWidth}
          min={PORTFOLIO_MIN}
          max={PORTFOLIO_MAX}
          reset={PORTFOLIO_DEFAULT}
          clamp={clampPortfolioWidth}
          onCommit={(w) => updateUiPrefs({ portfolioWidth: w })}
          label="Width of the navigator"
        />
        <main className="wlv-pane wlv-sheet">
          <header className="wlv-head">
            <div className="wlv-title-block">
              <h2 className="wlv-sheet-title">
                {account && <span className={`xch-badge pfv-title-badge${account.testnet ? "" : " is-live"}`}>{account.testnet ? "TESTNET" : "LIVE"}</span>}
                <span className="pv-ink">{noAccount ? "No account yet" : account ? account.label : "All portfolios"}</span>
              </h2>
              <p className="wlv-sheet-sub">
                {noAccount
                  ? "The portfolio reads the exchange accounts you add in Settings → Auth."
                  : account
                    ? account.error
                      ? `${account.exchange} · could not be read: ${account.error}`
                      : `${account.exchange}${account.testnet ? " · testnet, not counted in the whole" : ""}`
                    : s
                      ? `${s.accounts.filter((a) => !a.testnet).length} live accounts${s.testnetUsd > 0 ? " · testnet shown apart, never counted" : ""}${m?.rateNote ? ` · ${m.rateNote}` : ""}`
                      : "Reading the balances of every wallet…"}
              </p>
            </div>
            {status && <span className="wlv-status">{status}</span>}
            {!noAccount && (
              <button type="button" className="wlv-icon" onClick={reload} disabled={loading} aria-label="Read the accounts again" title="Read the accounts again">
                <Refresh />
              </button>
            )}
            {!noAccount && <span className="pfv-export">{report.button(!s)}</span>}
          </header>
          {error && <p className="wlv-problem">{error}</p>}
          <div className="pfv-report">{report.result}</div>
          <div className="wlv-body pfv-body">
            {noAccount ? (
              <div className="pfv-empty">
                <button type="button" className="pfv-cta" onClick={() => goToSettings({ tab: "auth" })}>
                  Add an exchange account
                </button>
              </div>
            ) : (
              s && m && <Dashboard summary={s} account={account} series={series} period={period} onPeriod={setPeriod} value={value} perUsd={m.perUsd} currency={m.currency} onScope={setScope} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
