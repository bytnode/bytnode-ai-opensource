"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/icons";
import { useLocale, useMessages } from "@/lib/i18n/react";
import { dateTag, numberTag } from "@/lib/i18n/store";

/* The small pieces every plugin view shares: a figure, a change with its
   sign, a big number, the loading line, an error. */

/** Up to 8 significant digits, grouped, in the interface's language (a
    component that shows it reads `useMessages()`, so it renders again). */
export const fmt = (n: number | undefined | null, digits?: number): string => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (digits !== undefined) return n.toLocaleString(numberTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return Number(n.toPrecision(8)).toLocaleString(numberTag(), { maximumFractionDigits: 8 });
};

export const money = (n: number | undefined | null, currency: string): string => (typeof n === "number" && Number.isFinite(n) ? `${fmt(n, 2)} ${currency}` : "—");

export function Change({ pct }: { pct: number | undefined | null }) {
  useLocale();
  if (typeof pct !== "number" || !Number.isFinite(pct)) return <span className="pv-muted">—</span>;
  return (
    <span className={pct > 0 ? "pv-up" : pct < 0 ? "pv-down" : undefined}>
      {pct >= 0 ? "+" : "−"}
      {fmt(Math.abs(pct), 2)} %
    </span>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pv-kpi">
      <span className="pv-kpi-label">{label}</span>
      <span className="pv-kpi-value">{value}</span>
      {sub && <span className="pv-kpi-sub">{sub}</span>}
    </div>
  );
}

export function Loading() {
  const m = useMessages();
  return (
    <p className="pv-note pv-loading">
      <Spinner /> {m.common.loading}
    </p>
  );
}

export function Problem({ message }: { message: string }) {
  return (
    <div className="notice pv-error" role="alert">
      <p>{message}</p>
    </div>
  );
}

/** A small line chart of a series, in the page's ink. */
export function Sparkline({ points, height = 140 }: { points: Array<{ t: number; v: number }>; height?: number }) {
  const m = useMessages();
  if (points.length < 2) return null;
  const W = 800;
  const H = height;
  const pad = 24;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - pad} L${x(t0).toFixed(1)},${H - pad} Z`;
  const day = (t: number) => new Date(t).toLocaleDateString(dateTag(), { day: "numeric", month: "short" });
  return (
    <svg className="pv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={m.plugins.evolution}>
      <path className="pv-chart-area" d={area} />
      <path className="pv-chart-line" d={line} />
      <text className="pv-chart-axis" x={pad} y={H - 6}>
        {day(t0)}
      </text>
      <text className="pv-chart-axis" x={W - pad} y={H - 6} textAnchor="end">
        {day(t1)}
      </text>
      <text className="pv-chart-axis" x={W - pad} y={pad - 8} textAnchor="end">
        {fmt(hi, 0)}
      </text>
      <text className="pv-chart-axis" x={W - pad} y={H - pad + 12} textAnchor="end">
        {fmt(lo, 0)}
      </text>
    </svg>
  );
}
