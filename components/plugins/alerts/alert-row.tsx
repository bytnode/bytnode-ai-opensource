"use client";

import { useState } from "react";
import { WATCHLIST, alertLabel, type Alert } from "@/lib/plugins/alerts/alerts";
import { Pause, Play, Trash } from "@/components/ui/icons";

/* ---------------------------------------------------------------------------
   One alert, one tile: a light that says its state, the asset and the
   condition in words, what it read last (per asset for a watchlist
   alert), when it fired, and its two actions — pause or resume, delete (a
   second click confirms).

     green    watching            amber    true right now
     red      cannot be checked   grey     paused, or done
--------------------------------------------------------------------------- */

export type AlertState = "watching" | "holding" | "failing" | "paused" | "done";

export function stateOf(a: Alert): AlertState {
  if (a.status === "done") return "done";
  if (a.status === "paused") return "paused";
  if (Object.keys(a.errors ?? {}).length) return "failing";
  return Object.values(a.state).some((s) => s.holds) ? "holding" : "watching";
}

const STATE_LABEL: Record<AlertState, string> = { watching: "Watching", holding: "True now", failing: "Cannot check", paused: "Paused", done: "Done" };

/** "3 min ago", "2 h ago", "12 Sep". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

type Props = { alert: Alert; now: number; account: string | null; onPause: (paused: boolean) => void; onDelete: () => void };

export function AlertRow({ alert: a, now, account, onPause, onDelete }: Props) {
  const [confirm, setConfirm] = useState(false);
  const state = stateOf(a);
  const readings = Object.entries(a.state).filter(([, s]) => s.observed);
  const fired = Object.values(a.state)
    .map((s) => s.firedAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop();
  const errors = Object.entries(a.errors ?? {});
  const many = a.target === WATCHLIST;

  return (
    <article className={`alv-row is-${state}`}>
      <span className="alv-light" title={STATE_LABEL[state]} aria-label={STATE_LABEL[state]} role="img" />
      <div className="alv-row-main">
        <p className="alv-row-title">
          <b>{many ? "Watchlist" : a.target}</b>
          <span>{alertLabel(a.condition)}</span>
        </p>
        <p className="alv-row-sub">
          {errors.length ? (
            <span className="is-bad" title={errors.map(([s, e]) => `${s}: ${e}`).join("\n")}>
              {many ? `${errors[0][0]}: ` : ""}
              {errors[0][1]}
            </span>
          ) : readings.length ? (
            <>
              {readings
                .slice(0, many ? 3 : 1)
                .map(([symbol, s]) => `${many ? `${symbol.split("/")[0]} ` : ""}${s.observed}`)
                .join(" · ")}
              {many && readings.length > 3 ? ` · +${readings.length - 3}` : ""}
              {readings[0][1].checkedAt ? <span className="alv-muted"> · read {ago(readings[0][1].checkedAt, now)}</span> : null}
            </>
          ) : (
            <span className="alv-muted">{a.status === "paused" ? "Not checked while paused" : "Waiting for the first check"}</span>
          )}
          {a.note && <span className="alv-note-text"> — {a.note}</span>}
        </p>
      </div>
      <div className="alv-row-meta">
        <span className="alv-tag">{a.once ? "Once" : "Every time"}</span>
        {account && <span className="alv-tag">{account}</span>}
        <span className="alv-fired">{fired ? `Fired ${ago(fired, now)}` : state === "done" ? "Done" : "Never fired"}</span>
      </div>
      <div className="alv-row-actions">
        {a.status !== "done" && (
          <button type="button" className="alv-icon" onClick={() => onPause(a.status !== "paused")} aria-label={a.status === "paused" ? "Resume the alert" : "Pause the alert"} title={a.status === "paused" ? "Resume" : "Pause"}>
            {a.status === "paused" ? <Play /> : <Pause />}
          </button>
        )}
        <button
          type="button"
          className={`alv-icon is-danger${confirm ? " is-armed" : ""}`}
          onBlur={() => setConfirm(false)}
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
          aria-label={confirm ? "Click again to delete" : "Delete the alert"}
          title={confirm ? "Click again to delete" : "Delete"}
        >
          <Trash />
        </button>
      </div>
    </article>
  );
}
