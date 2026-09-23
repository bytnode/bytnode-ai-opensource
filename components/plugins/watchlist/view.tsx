"use client";

import { useState } from "react";
import type { WatchItem } from "@/lib/plugins/watchlist/list";
import type { Quote } from "@/lib/plugins/shared/quote";
import { Close, Plus } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useOnWake } from "../view-activity";
import { Change, Loading, Problem, fmt } from "../bits";

/* ---------------------------------------------------------------------------
   The Watchlist tab: the assets the user follows, their price and their
   changes, added and removed right here — the same list the agents read.
--------------------------------------------------------------------------- */

type Row = WatchItem & { quote: Quote | null; error: string | null };

export function WatchlistView({ settings, params }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<Row[]>("watchlist", "list", settings);
  useOnWake(reload);
  const [symbol, setSymbol] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const focus = typeof params?.symbol === "string" ? params.symbol.toUpperCase() : null;

  const edit = async (change: Record<string, unknown>) => {
    setProblem(await act("watchlist", "edit", change, settings));
    reload();
  };

  const add = async () => {
    if (!symbol.trim()) return;
    await edit({ add: [symbol], note });
    setSymbol("");
    setNote("");
  };

  return (
    <>
      <form
        className="pv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="wl-symbol">
            Asset
          </label>
          <input id="wl-symbol" className="field-input" placeholder="btc, ETH/USDT, SOLUSDT…" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wl-note">
            Note <small>optional</small>
          </label>
          <input id="wl-note" className="field-input" placeholder="Why you follow it" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!symbol.trim()}>
          <Plus />
          Add
        </button>
      </form>
      {problem && <Problem message={problem} />}
      {error && <Problem message={error} />}
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="pv-note">Your watchlist is empty. Add an asset above, or ask an agent: &quot;add BTC and ETH to my watchlist&quot;.</p>
      ) : (
        <section className="pv-section">
          <h2 className="pv-section-title">
            {data.length} asset{data.length > 1 ? "s" : ""}
            {loading && <span className="pv-chip">Updating…</span>}
          </h2>
          <div className="pv-table-wrap">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Price</th>
                  <th className="num">24 h</th>
                  <th className="num">7 d</th>
                  <th>Source</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.symbol} className={focus && r.symbol.startsWith(focus.split("/")[0]) ? "is-focus" : undefined}>
                    <td>
                      <strong>{r.symbol}</strong>
                      {r.tags?.map((t) => (
                        <span key={t} className="pv-chip pv-tag">
                          {t}
                        </span>
                      ))}
                    </td>
                    <td className="num">{r.quote ? fmt(r.quote.price) : "—"}</td>
                    <td className="num">
                      <Change pct={r.quote?.change24h} />
                    </td>
                    <td className="num">
                      <Change pct={r.quote?.change7d} />
                    </td>
                    <td className="pv-muted">{r.quote ? `${r.quote.source} · ${new Date(r.quote.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : (r.error ?? "—")}</td>
                    <td className="pv-muted">{r.note ?? ""}</td>
                    <td className="pv-actions">
                      <button type="button" className="st-icon" onClick={() => void edit({ remove: [r.symbol] })} aria-label={`Remove ${r.symbol}`} title="Remove">
                        <Close />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pv-note">Prices from BytNode, or from your exchange for a pair BytNode does not cover. Your agents see this list in their prompt.</p>
        </section>
      )}
    </>
  );
}
