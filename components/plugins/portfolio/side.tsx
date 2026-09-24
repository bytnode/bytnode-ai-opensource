"use client";

import type { CSSProperties } from "react";
import type { Summary } from "@/lib/plugins/portfolio/aggregate";
import { CurrencyMenu } from "./currency-menu";

/* The left column, a navigator: the tab's name with the currency beside
   it; "All portfolios" — the whole, its total and its move over the
   period — then each account, to see it on its own: its LIVE / TESTNET
   badge (never dropped: which money is real is a guarantee of the app),
   its exchange, its value and its share of the whole as a thin bar, or
   why it could not be read. */

export const ALL = "all";
export const accountKey = (a: { exchange: string; label: string }) => `${a.exchange}:${a.label}`;

type Props = {
  summary: Summary | null;
  scope: string;
  onScope: (key: string) => void;
  currency: string;
  onCurrency: (c: string) => void;
  value: (usd: number) => string;
  /** The whole's move over the period, already written ("+4.2 %"). */
  move: { text: string; tone: string } | null;
};

export function Side({ summary, scope, onScope, currency, onCurrency, value, move }: Props) {
  const accounts = summary?.accounts ?? [];
  const total = summary?.totalUsd ?? 0;
  return (
    <section className="wlv-pane wlv-side pfv-side" aria-label="Portfolios">
      <header className="pfv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Portfolio</span>
        </h2>
        <CurrencyMenu value={currency} onChange={onCurrency} />
      </header>

      {summary && (
        <button type="button" className={`pfv-whole${scope === ALL ? " is-on" : ""}`} aria-pressed={scope === ALL} onClick={() => onScope(ALL)}>
          <span className="pfv-whole-label">All portfolios</span>
          <span className="pfv-whole-value">{value(total)}</span>
          <span className="pfv-whole-sub">
            {accounts.filter((a) => !a.testnet).length} live account{accounts.filter((a) => !a.testnet).length === 1 ? "" : "s"}
            {move && <b className={move.tone}>{move.text}</b>}
          </span>
        </button>
      )}

      {accounts.length > 0 && (
        <>
          <p className="pfv-side-title">Accounts</p>
          <ul className="pfv-accounts">
            {accounts.map((a) => {
              const key = accountKey(a);
              const share = !a.testnet && total > 0 ? a.usd / total : 0;
              return (
                <li key={key}>
                  <button type="button" className={`pfv-account${scope === key ? " is-on" : ""}${a.error ? " is-error" : ""}`} aria-pressed={scope === key} onClick={() => onScope(key)}>
                    <span className="pfv-account-top">
                      <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                      <b>{a.label}</b>
                      <span className="pfv-account-value">{value(a.usd)}</span>
                    </span>
                    <span className="pfv-account-sub">
                      {a.error ? `Could not be read: ${a.error}` : `${a.exchange}${a.testnet ? " · not counted" : ` · ${(share * 100).toFixed(1)} %`}${a.unpriced ? ` · ${a.unpriced} unpriced` : ""}`}
                    </span>
                    {!a.testnet && !a.error && (
                      <span className="pfv-account-bar" aria-hidden>
                        <i style={{ "--w": `${share * 100}%` } as CSSProperties} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
