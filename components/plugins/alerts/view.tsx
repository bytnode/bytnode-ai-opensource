"use client";

import { useState } from "react";
import { WATCHLIST, type Alert, type Trigger } from "@/lib/plugins/alerts/alerts";
import { EXAMPLES } from "@/lib/plugins/alerts/conditions";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { Loading, Problem } from "../bits";

/* ---------------------------------------------------------------------------
   The Alerts tab: create an alert, see which are active, which fired, which
   cannot be checked (and why), and what fired lately.
--------------------------------------------------------------------------- */

type State = { alerts: Alert[]; triggers: Trigger[]; calendar: boolean };

const REFRESH = 15_000;
const POSITION = /^(pnl|liq|closed)/i;
const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function AlertsView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<State>("alerts", "state", settings);
  const [target, setTarget] = useState("BTC/USDT");
  const [condition, setCondition] = useState("");
  const [once, setOnce] = useState(true);
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState(settings.keys.exchanges[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  useAwakeInterval(reload, REFRESH);

  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("alerts", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };
  const create = async () => {
    const p = await run("create", { target, condition, once, note, ...(POSITION.test(condition.trim()) ? { accountId } : {}) });
    if (p) return;
    setCondition("");
    setNote("");
  };

  const onPosition = POSITION.test(condition.trim());
  const accountName = (id?: string) => settings.keys.exchanges.find((a) => a.id === id)?.label;

  return (
    <>
      <form
        className="pv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="al-target">
            On
          </label>
          <input id="al-target" className="field-input" list="al-targets" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="BTC/USDT, or watchlist" />
          <datalist id="al-targets">
            <option value={WATCHLIST}>Every asset of the watchlist</option>
          </datalist>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="al-condition">
            When
          </label>
          <input id="al-condition" className="field-input" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="price>=70000" title={EXAMPLES.replace(/`/g, "")} />
        </div>
        {onPosition && (
          <div className="field">
            <label className="field-label" htmlFor="al-account">
              Account
            </label>
            <Select id="al-account" label="Account" value={accountId} options={settings.keys.exchanges.map((a) => ({ value: a.id, label: a.label }))} placeholder="No exchange account" onChange={setAccountId} />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="al-note">
            Note <small>optional</small>
          </label>
          <input id="al-note" className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why" />
        </div>
        <span className="cv-switch">
          <Switch on={once} onChange={setOnce} label="Fire once" />
          {once ? "Once" : "Every crossing"}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!target.trim() || !condition.trim()}>
          <Plus />
          Create
        </button>
      </form>
      <p className="pv-note">
        Conditions: {EXAMPLES.replace(/`/g, "")}
        {data && !data.calendar ? " (event alerts need the market calendar)" : ""}. Checked every minute while the app is open; one notification per crossing.
      </p>
      {problem && <Problem message={problem} />}
      {error && <Problem message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="pv-section">
            <h2 className="pv-section-title">
              Alerts
              {loading && <span className="pv-chip">Updating…</span>}
            </h2>
            {data.alerts.length === 0 ? (
              <p className="pv-note">No alert yet. Create one above, or ask an agent: &quot;tell me if ETH drops below 3 000&quot;.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>On</th>
                      <th>When</th>
                      <th>Fires</th>
                      <th>State</th>
                      <th>Last fired</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.alerts.map((a) => {
                      const fired = Object.values(a.state)
                        .map((s) => s.firedAt)
                        .filter((x): x is string => Boolean(x))
                        .sort()
                        .pop();
                      const errors = Object.entries(a.errors ?? {});
                      return (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.target === WATCHLIST ? "Watchlist" : a.target}</strong>
                            {a.accountId && <span className="pv-muted"> · {accountName(a.accountId) ?? "account removed"}</span>}
                            {a.note && <div className="pv-muted">{a.note}</div>}
                          </td>
                          <td className="mono">{a.condition}</td>
                          <td className="pv-muted">{a.once ? "once" : "every crossing"}</td>
                          <td>
                            {errors.length ? (
                              <span className="pv-down" title={errors.map(([s, e]) => `${s}: ${e}`).join("\n")}>
                                cannot check: {errors[0][1]}
                              </span>
                            ) : a.status === "done" ? (
                              <span className="pv-chip">done</span>
                            ) : (
                              <span className="pv-chip is-strong">active</span>
                            )}
                          </td>
                          <td className="pv-muted">{fired ? time(fired) : "—"}</td>
                          <td className="pv-actions">
                            <button type="button" className="st-icon" onClick={() => void run("delete", { id: a.id })} aria-label={`Delete the alert ${a.target} ${a.condition}`} title="Delete">
                              <Trash />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="pv-section">
            <h2 className="pv-section-title">Fired lately</h2>
            {data.triggers.length === 0 ? (
              <p className="pv-note">Nothing yet.</p>
            ) : (
              <ul className="sv-runs">
                {data.triggers.map((t) => (
                  <li key={t.id}>
                    <div className="sv-run-head">
                      <strong>
                        {t.symbol} · {t.condition}
                      </strong>
                      <span className="pv-muted">{time(t.at)}</span>
                    </div>
                    <p className="sv-run-body">
                      {t.observed}
                      {t.note ? ` — ${t.note}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
