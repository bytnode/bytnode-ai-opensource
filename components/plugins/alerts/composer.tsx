"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { WATCHLIST } from "@/lib/plugins/alerts/alerts";
import { describeCondition, type CompareOp } from "@/lib/plugins/alerts/conditions";
import { PRESETS, buildCondition, compares, crosses, defaultAgainst, defaultMetric, draftCondition, type Draft, type PositionField, type Subject } from "@/lib/plugins/alerts/draft";
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
   A new alert, in four plain steps — one tile each: the ASSET, what to
   WATCH on it, the CONDITION, how to NOTIFY — under a row of presets that
   fill them in one click. Anything can be watched: the price, its change,
   the funding, any indicator with the user's own length and timeframe, a
   position's PnL or liquidation distance, a calendar event; against a
   level or another indicator. The last line says the alert in words, with
   what it reads NOW on the asset (the plugin's `preview`, a moment after
   the last change), and creates it.
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

/** Levels a user often picks, per metric. */
const QUICK: Partial<Record<MetricKind, string[]>> = { rsi: ["20", "30", "50", "70", "80"], stoch: ["20", "50", "80"], change: ["-10", "-5", "5", "10"], funding: ["-0.01", "0.05", "0.1"], macd: ["0"] };

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
  const [draft, setDraft] = useState<Draft>(PRESETS[1].draft);
  const [once, setOnce] = useState(true);
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<string | null>(PRESETS[1].id);

  const s = draft.subject;
  const condition = buildCondition(draft);
  const parsed = draftCondition(draft);
  const onPosition = s.kind === "position";
  const text = typeof condition === "string" ? condition : "";

  /* What the condition reads now, a moment after the last change. */
  const query = JSON.stringify({ target, condition: text });
  const [preview, setPreview] = useState<{ query: string; result: Preview } | null>(null);
  const previewable = text !== "" && !onPosition && s.kind !== "event" && !("error" in parsed);
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

  const change = (next: Partial<Draft>) => {
    setDraft({ ...draft, ...next });
    setPreset(null);
  };
  const watch = (subject: Subject) => {
    /* A new kind of thing watched: its usual comparison. */
    const op = crosses(subject) ? draft.op : draft.op === "crosses_above" ? ">" : draft.op === "crosses_below" ? "<" : draft.op;
    const against = subject.kind === "metric" ? defaultAgainst(subject.metric) : { kind: "value" as const, value: subject.kind === "position" && subject.field === "liq" ? "5" : "" };
    change({ subject, op, against });
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

  const presets = PRESETS.filter((p) => !p.position || accounts.length);
  const sentence = "error" in parsed ? null : describeCondition(parsed);
  const where = target === WATCHLIST ? "each asset of my watchlist" : target;

  return (
    <section className="alv-composer" aria-label="New alert">
      <header className="alv-composer-head">
        <h2 className="alv-h2">New alert</h2>
        <span className="alv-spacer" />
        <button type="button" className="alv-icon" onClick={onClose} aria-label="Close" title="Close">
          <Close />
        </button>
      </header>

      <div className="alv-presets" role="group" aria-label="Presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`alv-preset${preset === p.id ? " is-on" : ""}`}
            onClick={() => {
              setDraft(p.draft);
              setPreset(p.id);
              setProblem(null);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="alv-steps">
        <div className="alv-step">
          <span className="alv-step-label">
            <i>1</i>Asset
          </span>
          <div className="alv-step-body">
            <PairField value={target} pairs={pairs} onChange={setTarget} />
          </div>
        </div>

        <div className="alv-step">
          <span className="alv-step-label">
            <i>2</i>Watch
          </span>
          <div className="alv-step-body">
            <Chips label="Market" options={MARKET} value={s.kind === "metric" ? s.metric.kind : null} onChange={pickKind} />
            <Chips label="Indicators" options={INDICATORS} value={s.kind === "metric" ? s.metric.kind : null} onChange={pickKind} />
            {accounts.length > 0 && <Chips label="Position" options={POSITION} value={s.kind === "position" ? s.field : null} onChange={(field) => watch({ kind: "position", field })} />}
            {calendar && <Chips label="Calendar" options={[{ kind: "event", label: "Coming event" }]} value={s.kind === "event" ? "event" : null} onChange={() => watch({ kind: "event", hours: 24 })} />}
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
                  <span>Within</span>
                  <Segmented label="Within" value={String(s.hours)} options={["6", "12", "24", "48", "72"].map((h) => ({ value: h, label: `${h} h` }))} onChange={(h) => change({ subject: { kind: "event", hours: Number(h) } })} />
                </label>
              </div>
            )}
          </div>
        </div>

        {compares(s) && (
          <div className="alv-step">
            <span className="alv-step-label">
              <i>3</i>Condition
            </span>
            <div className="alv-step-body">
              <Segmented label="Condition" value={draft.op} options={crosses(s) ? OPS : OPS.slice(0, 2)} onChange={(op) => change({ op })} />
              <p className="alv-hint">{hint(draft)}</p>
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
                <div className="alv-value">
                  <span className="alv-level">
                    <input
                      className="alv-input"
                      inputMode="decimal"
                      aria-label="Level"
                      placeholder={now && "observed" in now ? "Level" : "Level — e.g. 70000"}
                      value={draft.against.value}
                      onChange={(e) => change({ against: { kind: "value", value: e.target.value } })}
                    />
                    {unitOf(draft) && <small>{unitOf(draft)}</small>}
                  </span>
                  {now && "value" in now && now.value !== undefined && s.kind === "metric" && !QUICK[s.metric.kind] && (
                    <button type="button" className="alv-chip" onClick={() => change({ against: { kind: "value", value: String(Number(now.value!.toPrecision(6))) } })} title="Start from the current value">
                      Now {Number(now.value.toPrecision(6))}
                    </button>
                  )}
                  {s.kind === "metric" &&
                    (QUICK[s.metric.kind] ?? []).map((v) => (
                      <button key={v} type="button" className={`alv-chip${draft.against.kind === "value" && draft.against.value === v ? " is-on" : ""}`} onClick={() => change({ against: { kind: "value", value: v } })}>
                        {v}
                      </button>
                    ))}
                </div>
              ) : (
                <MetricPicker metric={draft.against.metric} onChange={(metric) => change({ against: { kind: "metric", metric } })} />
              )}
            </div>
          </div>
        )}

        <div className="alv-step">
          <span className="alv-step-label">
            <i>{compares(s) ? 4 : 3}</i>Notify
          </span>
          <div className="alv-step-body is-row">
            <Segmented
              label="How often"
              value={once ? "once" : "every"}
              options={[
                { value: "once", label: "Once" },
                { value: "every", label: "Every time" },
              ]}
              onChange={(v) => setOnce(v === "once")}
            />
            <input className="alv-input alv-note" aria-label="Note" placeholder="A note, shown with the notification — optional" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </div>

      <footer className="alv-composer-foot">
        <div className="alv-summary">
          {sentence ? (
            <p className="alv-sentence">
              {where} · <b>{sentence}</b>
            </p>
          ) : (
            <p className="alv-sentence is-muted">{typeof condition === "string" ? "" : condition.error}</p>
          )}
          <p className="alv-now">
            {!previewable ? (onPosition ? "Read on the position at the first check." : " ") : !now ? "Reading…" : "error" in now ? <span className="is-bad">{now.error}</span> : <>Now: {now.observed}{now.holds && (draft.op === ">" || draft.op === "<") ? " — true already: it fires at the first check" : ""}</>}
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
    </section>
  );
}

