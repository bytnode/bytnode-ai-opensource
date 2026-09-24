"use client";

import type { CSSProperties } from "react";

/* The portfolio's small charts, drawn in SVG in the bare views' language
   — Apple's colours, 2 px gaps between parts, round ends only:
   - a donut of the split by asset, its parts 2 px apart;
   - a split bar of a few shares, with its legend.
   (The daily returns are drawn by the curve's chart, under its days.) */

export type Part = { key: string; label: string; value: number; tone: string };

/** A donut: each part an arc of its share, 2 px apart; `center` inside. */
export function Donut({ parts, center, sub }: { parts: Part[]; center: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 70;
  const stroke = 22;
  const c = 2 * Math.PI * r;
  const gap = parts.length > 1 ? 2.5 : 0;
  let offset = 0;
  return (
    <div className="pfv-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label={parts.map((p) => `${p.label} ${total > 0 ? ((p.value / total) * 100).toFixed(1) : 0} %`).join(", ")}>
        <circle cx="90" cy="90" r={r} fill="none" stroke="rgba(var(--ink), 0.06)" strokeWidth={stroke} />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * c;
            const dash = Math.max(0.5, len - gap);
            const el = <circle key={p.key} cx="90" cy="90" r={r} fill="none" stroke={p.tone} strokeWidth={stroke} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />;
            offset += len;
            return el;
          })}
      </svg>
      <div className="pfv-donut-center">
        <b>{center}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

/** A few shares side by side, 2 px apart, round at the ends; its legend
    under it. */
export function SplitBar({ parts: given, format }: { parts: Part[]; format: (p: Part, share: number) => string }) {
  /* A share is never below nothing. */
  const parts = given.map((p) => ({ ...p, value: Math.max(0, p.value) }));
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="pfv-split">
      <div className="pfv-split-bar">
        {total > 0 ? shown.map((p) => <i key={p.key} style={{ flexGrow: p.value, "--tone": p.tone } as CSSProperties} />) : <i style={{ flexGrow: 1, "--tone": "rgba(var(--ink), 0.08)" } as CSSProperties} />}
      </div>
      <ul className="pfv-split-legend">
        {parts.map((p) => (
          <li key={p.key} style={{ "--tone": p.tone } as CSSProperties}>
            <i />
            <span>{p.label}</span>
            <b>{format(p, total > 0 ? p.value / total : 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
