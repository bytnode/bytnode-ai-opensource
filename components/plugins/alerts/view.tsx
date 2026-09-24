"use client";

import { useCallback, useState } from "react";
import { WATCHLIST, alertLabel, type Alert, type Trigger } from "@/lib/plugins/alerts/alerts";
import type { Listed } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Plus } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { AlertRow, ago, stateOf } from "./alert-row";
import { Composer } from "./composer";
import "./alerts.css";

/* ---------------------------------------------------------------------------
   The Alerts tab, in the bare views' language but in ONE column — no side
   pane: the title and its counts, a filter, "New alert"; the alerts as a
   list of tiles (`alert-row.tsx`); and what fired lately. The
   plugin checks every minute while the app is open: the list is read
   again as often. "New alert" opens the form in a window over the page
   (`composer.tsx`).
--------------------------------------------------------------------------- */

type State = { alerts: Alert[]; triggers: Trigger[]; calendar: boolean };
type Filter = "all" | "active" | "paused" | "done";

const REFRESH = 15_000;
const TICK = 30_000;
const HISTORY = 12;

export function AlertsView({ settings }: ViewProps) {
  const { data, error, reload } = usePluginData<State>("alerts", "state", settings);
  const pairsData = usePluginData<Listed[]>("alerts", "pairs", settings, {}, { keep: "latest" });
  const pairs = Array.isArray(pairsData.data) && pairsData.data.length ? pairsData.data : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tick = useCallback(() => setNow(Date.now()), []);

  useAwakeInterval(reload, REFRESH);
  useAwakeInterval(tick, TICK);

  const alerts = data?.alerts ?? [];
  const count = (f: Filter) => alerts.filter((a) => f === "all" || (f === "active" ? a.status === "active" : a.status === f)).length;
  const shown = alerts.filter((a) => filter === "all" || (filter === "active" ? a.status === "active" : a.status === filter)).sort((a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt));
  const accountName = (id?: string) => (id ? (settings.keys.exchanges.find((x) => x.id === id)?.label ?? "account removed") : null);

  const run = async (action: string, params: Record<string, unknown>) => {
    setProblem(await act("alerts", action, params, settings));
    reload();
  };

  return (
    <div className="alv">
      <div className="alv-sheet">
        <div className="alv-page">
          <header className="alv-head">
            <div>
              <h1 className="alv-title pv-ink">Alerts</h1>
              <p className="alv-sub">
                {count("active")} watching{count("paused") ? ` · ${count("paused")} paused` : ""} · checked every minute while BytNode-AI is open
              </p>
            </div>
            <span className="alv-spacer" />
            {alerts.length > 0 && (
              <Segmented
                label="Show"
                value={filter}
                options={[
                  { value: "all", label: `All ${alerts.length}` },
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "done", label: "Done" },
                ]}
                onChange={setFilter}
              />
            )}
            <button type="button" className="alv-btn is-primary" onClick={() => setComposing(true)}>
              <Plus />
              New alert
            </button>
          </header>


          {(problem ?? error) && <p className="alv-problem">{problem ?? error}</p>}

          {data && alerts.length === 0 && (
            <div className="alv-empty">
              <p>No alert yet. Create one, or ask an agent: “tell me when the RSI of ETH on the hour drops under 30”.</p>
              <button type="button" className="alv-btn is-primary" onClick={() => setComposing(true)}>
                <Plus />
                New alert
              </button>
            </div>
          )}

          {shown.length > 0 && (
            <section className="alv-list" aria-label="Your alerts">
              {shown.map((a) => (
                <AlertRow key={a.id} alert={a} now={now} account={accountName(a.accountId)} onPause={(paused) => void run("pause", { id: a.id, paused })} onDelete={() => void run("delete", { id: a.id })} />
              ))}
            </section>
          )}
          {alerts.length > 0 && shown.length === 0 && <p className="alv-empty">Nothing {filter === "done" ? "done" : filter} here.</p>}

          {data && data.triggers.length > 0 && (
            <section className="alv-history" aria-label="Fired lately">
              <h2 className="alv-h2">Fired lately</h2>
              <div className="alv-list">
                {data.triggers.slice(0, HISTORY).map((t) => (
                  <div key={t.id} className="alv-fire">
                    <span className="alv-fire-when">{ago(t.at, now)}</span>
                    <b>{t.symbol}</b>
                    <span className="alv-fire-what">{alertLabel(t.condition)}</span>
                    <span className="alv-fire-seen">
                      {t.observed}
                      {t.note ? ` — ${t.note}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      {composing && (
        <Composer
          settings={settings}
          pairs={pairs}
          calendar={data?.calendar ?? false}
          onDone={() => {
            setComposing(false);
            setFilter("all");
            reload();
          }}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

/** What needs an eye first: an alert that cannot be checked, one true
    now, the watching ones, then paused and done. */
function order(a: Alert): number {
  return ["failing", "holding", "watching", "paused", "done"].indexOf(stateOf(a)) + (a.target === WATCHLIST ? 0.5 : 0);
}
