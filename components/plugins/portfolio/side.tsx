"use client";

import type { ReactNode } from "react";
import type { Summary } from "@/lib/plugins/portfolio/aggregate";
import { CURRENCIES } from "@/lib/plugins/shared/fx";
import { Segmented } from "@/components/ui/segmented";

/* The left column: the tab's name, the currency the figures are in, the
   accounts — each with its LIVE / TESTNET badge (never dropped: which
   money is real is a guarantee of the app), its exchange, its value and
   its share of the total, or why it could not be read — and, under a
   rule, the export as a report. */

type Props = {
  summary: Summary | null;
  currency: string;
  onCurrency: (c: string) => void;
  value: (usd: number) => string;
  exportButton: ReactNode;
  exportResult: ReactNode;
};

const OPTIONS = CURRENCIES.map((c) => ({ value: c as string, label: c }));

export function Side({ summary, currency, onCurrency, value, exportButton, exportResult }: Props) {
  const accounts = summary?.accounts ?? [];
  const total = summary?.totalUsd ?? 0;
  return (
    <section className="wlv-pane wlv-side" aria-label="Accounts">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Portfolio</span>
        </h2>
        {accounts.length > 0 && <span className="wlv-count">{accounts.length}</span>}
      </header>
      <div className="wlv-windows">
        <Segmented label="Currency" value={currency} options={OPTIONS} onChange={onCurrency} wide />
      </div>
      {accounts.length > 0 && (
        <>
          <p className="pfv-side-title">
            <span className="pv-ink">Accounts</span>
          </p>
          <ul className="pfv-accounts">
            {accounts.map((a) => (
              <li key={`${a.exchange}:${a.label}`} className={`pfv-account${a.error ? " is-error" : ""}`}>
                <span className="pfv-account-name">
                  <b>
                    <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                    {a.label}
                  </b>
                  <small>{a.error ? `Could not be read: ${a.error}` : `${a.exchange}${a.unpriced ? ` · ${a.unpriced} unpriced asset${a.unpriced > 1 ? "s" : ""}` : ""}${a.testnet ? " · not counted" : ""}`}</small>
                </span>
                <span className="pfv-account-value">
                  {value(a.usd)}
                  {!a.testnet && total > 0 && <small>{((a.usd / total) * 100).toFixed(1)} %</small>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {exportButton && (
        <div className="wlv-switches pv-rule pfv-export">
          {exportButton}
          {exportResult}
        </div>
      )}
    </section>
  );
}
