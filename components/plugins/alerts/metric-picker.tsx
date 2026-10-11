"use client";

import { useState } from "react";
import type { Interval } from "@/lib/plugins/shared/candle";
import { defaultMetric } from "@/lib/plugins/alerts/draft";
import { TIMEFRAMES, WINDOWS, timeframeOf, type Metric, type MetricKind } from "@/lib/plugins/alerts/metrics";
import { Segmented } from "@/components/ui/segmented";
import { useMessages } from "@/lib/i18n/react";
import type { Messages } from "@/lib/i18n/messages/en";

/* ---------------------------------------------------------------------------
   A metric and its parameters, as chips and a few small fields: the kind
   first (the market's figures, then the indicators), then only what that
   kind takes — its length, its timeframe, which of its lines. Changing the
   kind keeps the timeframe. Used for what an alert watches and for what it
   is compared with.
--------------------------------------------------------------------------- */

/** The market's figures, then the indicators — with their names in the
    interface's language (the acronyms stay as traders write them). */
export const MARKET_KINDS: MetricKind[] = ["price", "change", "funding"];

export const market = (t: Messages): Array<{ kind: MetricKind; label: string }> => [
  { kind: "price", label: t.alerts.metric.price },
  { kind: "change", label: t.alerts.metric.change },
  { kind: "funding", label: t.alerts.metric.funding },
];

export const indicators = (t: Messages): Array<{ kind: MetricKind; label: string }> => [
  { kind: "rsi", label: "RSI" },
  { kind: "ema", label: "EMA" },
  { kind: "sma", label: "SMA" },
  { kind: "macd", label: "MACD" },
  { kind: "bb", label: t.alerts.metric.bollinger },
  { kind: "stoch", label: t.alerts.metric.stochastic },
  { kind: "atr", label: "ATR" },
  { kind: "volume", label: t.alerts.metric.volume },
];

const TF_OPTIONS = TIMEFRAMES.map((t) => ({ value: t, label: t.replace("h", "H").replace("d", "D") }));

export function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ kind: T; label: string }>; value: T | null; onChange: (kind: T) => void }) {
  return (
    <div className="alv-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.kind} type="button" role="radio" aria-checked={value === o.kind} className={`alv-chip${value === o.kind ? " is-on" : ""}`} onClick={() => onChange(o.kind)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small whole-number field: what is typed stays as typed; a number in
    range is taken at once, anything else goes back to the last one taken
    when the field is left. */
function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }
  return (
    <label className="alv-num">
      <span>{label}</span>
      <input
        className="alv-input is-small"
        inputMode="numeric"
        value={text}
        onBlur={() => setText(String(value))}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "");
          setText(raw);
          const n = Number(raw);
          if (raw && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}

export function MetricParams({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  const w = useMessages().alerts.metric;
  const tf = timeframeOf(metric);
  return (
    <div className="alv-params">
      {metric.kind === "change" && <Segmented label={w.over} value={metric.window} options={WINDOWS.map((w) => ({ value: w, label: w }))} onChange={(window) => onChange({ ...metric, window })} />}
      {(metric.kind === "rsi" || metric.kind === "ema" || metric.kind === "sma" || metric.kind === "atr" || metric.kind === "bb" || metric.kind === "stoch") && (
        <Num label={w.length} value={metric.length} min={2} max={500} onChange={(length) => onChange({ ...metric, length })} />
      )}
      {metric.kind === "macd" && (
        <>
          <Num label={w.fast} value={metric.fast} min={2} max={200} onChange={(fast) => onChange({ ...metric, fast })} />
          <Num label={w.slow} value={metric.slow} min={3} max={400} onChange={(slow) => onChange({ ...metric, slow })} />
          <Num label={w.signal} value={metric.signal} min={2} max={100} onChange={(signal) => onChange({ ...metric, signal })} />
          <Segmented label={w.line} value={metric.line} options={[{ value: "macd", label: "MACD" }, { value: "signal", label: w.signal }, { value: "hist", label: w.histogram }]} onChange={(line) => onChange({ ...metric, line })} />
        </>
      )}
      {metric.kind === "bb" && (
        <>
          <Num label={w.deviations} value={metric.mult} min={1} max={5} onChange={(mult) => onChange({ ...metric, mult })} />
          <Segmented label={w.band} value={metric.band} options={[{ value: "upper", label: w.upper }, { value: "middle", label: w.middle }, { value: "lower", label: w.lower }]} onChange={(band) => onChange({ ...metric, band })} />
        </>
      )}
      {metric.kind === "stoch" && (
        <>
          <Num label={w.smoothing} value={metric.smooth} min={1} max={50} onChange={(smooth) => onChange({ ...metric, smooth })} />
          <Segmented label={w.line} value={metric.line} options={[{ value: "k", label: "%K" }, { value: "d", label: "%D" }]} onChange={(line) => onChange({ ...metric, line })} />
        </>
      )}
      {tf && (
        <label className="alv-num">
          <span>{w.timeframe}</span>
          <Segmented label={w.timeframe} value={tf} options={TF_OPTIONS} onChange={(t: Interval) => onChange({ ...metric, tf: t } as Metric)} />
        </label>
      )}
    </div>
  );
}

/** A metric picked among all of them (what an alert is compared with):
    the market or an indicator, then which one. */
export function MetricPicker({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  const t = useMessages();
  const w = t.alerts.metric;
  const pick = (kind: MetricKind) => onChange(defaultMetric(kind, timeframeOf(metric) ?? "1h"));
  const onMarket = MARKET_KINDS.includes(metric.kind);
  return (
    <div className="alv-picker">
      <Segmented label={w.comparedWith} value={onMarket ? "market" : "indicator"} options={[{ value: "market", label: w.market }, { value: "indicator", label: w.indicator }]} onChange={(g) => g !== (onMarket ? "market" : "indicator") && pick(g === "market" ? "price" : "ema")} />
      {onMarket ? <Chips label={w.market} options={market(t)} value={metric.kind} onChange={pick} /> : <Chips label={w.indicators} options={indicators(t)} value={metric.kind} onChange={pick} />}
      <MetricParams metric={metric} onChange={onChange} />
    </div>
  );
}
