"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { WATCHLIST } from "@/lib/plugins/alerts/alerts";
import { describeCondition, type CompareOp } from "@/lib/plugins/alerts/conditions";
import { BLANK_DRAFT, buildCondition, compares, crosses, defaultAgainst, defaultMetric, draftCondition, type Draft, type PositionField, type Subject } from "@/lib/plugins/alerts/draft";
import { metricUnit, timeframeOf, type Metric, type MetricKind } from "@/lib/plugins/alerts/metrics";
import { callPlugin } from "@/lib/plugins/client";
import type { Listed } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Close } from "@/components/ui/icons";
import { act } from "../use-plugin-data";
import { Chips, INDICATORS, MARKET, MetricParams, MetricPicker } from "./metric-picker";
import { PairField } from "./pair-field";

/* ---------------------------------------------------------------------------
   A new alert, in a window laid over the Alerts tab (the page dimmed and
   blurred behind it): four plain steps, one under the other with room to
   breathe — the ASSET, what to WATCH on it (one family at a time: the
   market, an indicator, a position, an event), the CONDITION, how to
   NOTIFY. Anything can be watched: the price, its change,
   the funding, any indicator with the user's own length and timeframe, a
   position's PnL or liquidation distance, a calendar event; against a
   level or another indicator. The last line says the alert in words, with
   what it reads NOW on the asset (the plugin's `preview`, a moment after
   the last change), and creates it. Escape, a click on the dimmed page or
   the ✕ closes it; what was set is lost.
--------------------------------------------------------------------------- */

const OPS: Array<{ value: CompareOp; label: string }> = [
  { value: ">", label: "Above" },
  { value: "<", label: "Below" },
  { value: "crosses_above", label: "Crosses above" },
  { value: "crosses_below", label: "Crosses below" },
];

const POSITION: Array<{ kind: PositionField; label: string }> = [
  { kind: "pnl", label: "PnL" },
  { kind: "pnlPct", label: "PnL %" },
  { kind: "liq", label: "Liquidation" },
  { kind: "closed", label: "Closed" },
];

type Group = "market" | "indicator" | "position" | "event";

const groupOf = (s: Subject): Group => (s.kind === "metric" ? (MARKET.some((m) => m.kind === s.metric.kind) ? "market" : "indicator") : s.kind);

const PREVIEW_DELAY = 500;

type Preview = { holds: boolean; observed: string; value?: number } | { error: string };

function hint(d: Draft): string {
  if (d.subject.kind === "event") return "Fires when a notable event (importance 2 or more) concerning the asset comes within that window — from the Calendar.";
  if (d.subject.kind === "position" && d.subject.field === "closed") return "Fires when the position, once open, is closed.";
  if (d.subject.kind === "position" && d.subject.field === "liq") return "The distance from the mark price to the liquidation price, in %.";
  if (d.op === "crosses_above" || d.op === "crosses_below") return "Fires only when it crosses after you set the alert.";
  return "Fires as soon as it is so — right away if it already is.";
}

const unitOf = (d: Draft): string => {
  if (d.subject.kind === "position") return d.subject.field === "pnl" ? "USDT" : "%";
  if (d.subject.kind !== "metric") return "";
  const u = metricUnit(d.subject.metric);
  return u === "%" ? "%" : u === "price" ? "USDT" : "";
};

type Props = { settings: Settings; pairs: Listed[] | null; calendar: boolean; onDone: () => void; onClose: () => void };

export function Composer({ settings, pairs, calendar, onDone, onClose }: Props) {
  const accounts = settings.keys.exchanges;
  const [target, setTarget] = useState("BTC/USDT");
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [once, setOnce] = useState(true);
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const s = draft.subject;
  const condition = buildCondition(draft);
  const parsed = draftCondition(draft);
  const onPosition = s.kind === "position";
  const text = typeof condition === "string" ? condition : "";

  /* What the condition reads now, a moment after the last change — with
     no level typed yet, read against 0: the current value is what the
     level field then shows. */
  const reading = text || (draft.against.kind === "value" && draft.against.value.trim() === "" ? buildCondition({ ...draft, against: { kind: "value", value: "0" } }) : "");
  const readText = typeof reading === "string" ? reading : "";
  const query = JSON.stringify({ target, condition: readText });
  const [preview, setPreview] = useState<{ query: string; result: Preview } | null>(null);
  const previewable = readText !== "" && !onPosition && s.kind !== "event";
  const keys = settings.keys;
  useEffect(() => {
    if (!previewable) return;
    let alive = true;
    const t = setTimeout(() => {
      callPlugin<Preview>("alerts", "preview", JSON.parse(query) as Record<string, unknown>, { bytnodeKey: keys.bytnode, exchangeAccounts: keys.exchanges }).then(
        (result) => alive && setPreview({ query, result }),
        (e: Error) => alive && setPreview({ query, result: { error: e.message } }),
      );
    }, PREVIEW_DELAY);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, previewable, keys]);
  const now = previewable && preview?.query === query ? preview.result : null;
  const current = now && "value" in now && now.value !== undefined ? Number(now.value.toPrecision(6)) : undefined;

  const change = (next: Partial<Draft>) => setDraft({ ...draft, ...next });
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const watch = (subject: Subject) => {
    /* A new kind of thing watched: its usual comparison. */
    const op = crosses(subject) ? draft.op : draft.op === "crosses_above" ? ">" : draft.op === "crosses_below" ? "<" : draft.op;
    const against = subject.kind === "metric" ? defaultAgainst(subject.metric) : { kind: "value" as const, value: subject.kind === "position" && subject.field === "liq" ? "5" : "" };
    change({ subject, op, against });
  };
  const groups: Array<{ value: Group; label: string }> = [
    { value: "market", label: "Market" },
    { value: "indicator", label: "Indicator" },
    ...(accounts.length ? [{ value: "position" as const, label: "Position" }] : []),
    ...(calendar ? [{ value: "event" as const, label: "Event" }] : []),
  ];
  const group = groupOf(s);
  const pickGroup = (g: Group) => {
    if (g === group) return;
    if (g === "market") pickKind("price");
    else if (g === "indicator") pickKind("rsi");
    else if (g === "position") watch({ kind: "position", field: "pnl" });
    else watch({ kind: "event", hours: 24 });
  };
  const pickKind = (kind: MetricKind) => watch({ kind: "metric", metric: defaultMetric(kind, (s.kind === "metric" && timeframeOf(s.metric)) || "1h") });

  const create = async () => {
    if (typeof condition !== "string") return setProblem(condition.error);
    setBusy(true);
    const p = await act("alerts", "create", { target, condition, once, note, ...(onPosition ? { accountId } : {}) }, settings);
    setBusy(false);
    setProblem(p);
    if (!p) onDone();
  };

  const sentence = "error" in parsed ? null : describeCondition(parsed);
  const where = target === WATCHLIST ? "each asset of my watchlist" : target;

  return (
    <div
      className="alv-overlay"
      onMouseDown={(e) => {
        /* A press on the dimmed page, not a drag that ends there. */
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="alv-composer" role="dialog" aria-modal="true" aria-label="New alert">
        <header className="alv-composer-head">
          <h2 className="alv-h2">New alert</h2>
          <span className="alv-spacer" />
          <button type="button" className="alv-icon" onClick={onClose} aria-label="Close" title="Close">
            <Close />
          </button>
        </header>

        <div className="alv-steps">
          <section className="alv-step">
            <h3 className="alv-step-label">Asset</h3>
            <PairField value={target} pairs={pairs} onChange={setTarget} />
          </section>

          <section className="alv-step">
            <h3 className="alv-step-label">Watch</h3>
            {groups.length > 1 && <Segmented label="What to watch" value={group} options={groups} onChange={pickGroup} />}
            {group === "market" && <Chips label="Market" options={MARKET} value={s.kind === "metric" ? s.metric.kind : null} onChange={pickKind} />}
            {group === "indicator" && <Chips label="Indicators" options={INDICATORS} value={s.kind === "metric" ? s.metric.kind : null} onChange={pickKind} />}
            {group === "position" && <Chips label="Position" options={POSITION} value={s.kind === "position" ? s.field : null} onChange={(field) => watch({ kind: "position", field })} />}
            {s.kind === "metric" && <MetricParams metric={s.metric} onChange={(metric: Metric) => change({ subject: { kind: "metric", metric } })} />}
            {s.kind === "position" && (
              <div className="alv-params">
                <label className="alv-num">
                  <span>Account</span>
                  <Select id="alv-account" label="Exchange account" value={accountId} options={accounts.map((a) => ({ value: a.id, label: a.label, meta: a.testnet ? "testnet" : undefined }))} onChange={setAccountId} />
                </label>
              </div>
            )}
            {s.kind === "event" && (
              <div className="alv-params">
                <label className="alv-num">
                  <span>A notable event within</span>
                  <Segmented label="Within" value={String(s.hours)} options={["6", "12", "24", "48", "72"].map((h) => ({ value: h, label: `${h} h` }))} onChange={(h) => change({ subject: { kind: "event", hours: Number(h) } })} />
                </label>
              </div>
            )}
          </section>

          {compares(s) && (
            <section className="alv-step">
              <h3 className="alv-step-label">Condition</h3>
              <Segmented label="Condition" value={draft.op} options={crosses(s) ? OPS : OPS.slice(0, 2)} onChange={(op) => change({ op })} />
              {s.kind === "metric" && (
                <Segmented
                  label="Compared with"
                  value={draft.against.kind}
                  options={[
                    { value: "value", label: "A value" },
                    { value: "metric", label: "Another indicator" },
                  ]}
                  onChange={(k) => change({ against: k === "value" ? defaultAgainst(s.metric) : { kind: "metric", metric: s.metric.kind === "price" ? defaultMetric("ema", "4h") : { kind: "price" } } })}
                />
              )}
              {draft.against.kind === "value" ? (
                <span className="alv-level">
                  <input
                    className="alv-input"
                    inputMode="decimal"
                    aria-label="Level"
                    placeholder={current !== undefined ? `Now ${current}` : "Level"}
                    value={draft.against.value}
                    onChange={(e) => change({ against: { kind: "value", value: e.target.value } })}
                  />
                  {unitOf(draft) && <small>{unitOf(draft)}</small>}
                </span>
              ) : (
                <MetricPicker metric={draft.against.metric} onChange={(metric) => change({ against: { kind: "metric", metric } })} />
              )}
              <p className="alv-hint">{hint(draft)}</p>
            </section>
          )}

          <section className="alv-step">
            <h3 className="alv-step-label">Notify</h3>
            <Segmented
              label="How often"
              value={once ? "once" : "every"}
              options={[
                { value: "once", label: "Once" },
                { value: "every", label: "Every time" },
              ]}
              onChange={(v) => setOnce(v === "once")}
            />
            <input className="alv-input" aria-label="Note" placeholder="A note, shown with the notification — optional" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </section>
        </div>

        <footer className="alv-composer-foot">
          <div className="alv-summary">
            {sentence ? (
              <p className="alv-sentence">
                {where} · <b>{sentence}</b>
              </p>
            ) : (
              <p className="alv-sentence is-muted">{typeof condition === "string" ? "" : condition.error === "Enter a number." ? "Type the level to finish the alert." : condition.error}</p>
            )}
            <p className="alv-now">
              {!previewable ? (onPosition ? "Read on the position at the first check." : " ") : !now ? "Reading…" : "error" in now ? <span className="is-bad">{now.error}</span> : <>Now: {now.observed}{text && now.holds && (draft.op === ">" || draft.op === "<") ? " — true already: it fires at the first check" : ""}</>}
            </p>
            {problem && <p className="alv-problem">{problem}</p>}
          </div>
          <button type="button" className="alv-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="alv-btn is-primary" disabled={busy || typeof condition !== "string" || !target.trim() || (onPosition && !accountId)} onClick={() => void create()}>
            Create alert
          </button>
        </footer>
      </div>
    </div>
  );
}

