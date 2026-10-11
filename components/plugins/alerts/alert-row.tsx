"use client";

import { useState } from "react";
import { WATCHLIST, type Alert } from "@/lib/plugins/alerts/alerts";
import { alertWords } from "@/lib/plugins/alerts/words";
import { useMessages } from "@/lib/i18n/react";
import { currentMessages, dateTag } from "@/lib/i18n/store";
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

/** "3 min ago", "2 h ago", "12 Sep" — in the interface's language, read
    at call time. */
export function ago(iso: string, now: number): string {
  const w = currentMessages().alerts.ago;
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return w.justNow;
  if (s < 3600) return w.minutes(Math.round(s / 60));
  if (s < 86_400) return w.hours(Math.round(s / 3600));
  return new Date(iso).toLocaleDateString(dateTag(), { day: "numeric", month: "short" });
}

type Props = { alert: Alert; now: number; account: string | null; telegram?: string; onPause: (paused: boolean) => void; onDelete: () => void };

export function AlertRow({ alert: a, now, account, telegram, onPause, onDelete }: Props) {
  const t = useMessages();
  const w = t.alerts.row;
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
      <span className="alv-light" title={w.states[state]} aria-label={w.states[state]} role="img" />
      <div className="alv-row-main">
        <p className="alv-row-title">
          <b>{many ? w.watchlist : a.target}</b>
          <span>{alertWords(a.condition)}</span>
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
              {readings[0][1].checkedAt ? <span className="alv-muted">{w.read(ago(readings[0][1].checkedAt, now))}</span> : null}
            </>
          ) : (
            <span className="alv-muted">{a.status === "paused" ? w.notWhilePaused : w.waiting}</span>
          )}
          {a.note && <span className="alv-note-text"> — {a.note}</span>}
        </p>
      </div>
      <div className="alv-row-meta">
        <span className="alv-tag">{a.once ? w.once : w.everyTime}</span>
        {account && <span className="alv-tag">{account}</span>}
        {telegram && <span className="alv-tag">Telegram · {telegram}</span>}
        <span className="alv-fired">{fired ? w.fired(ago(fired, now)) : state === "done" ? w.states.done : w.neverFired}</span>
      </div>
      <div className="alv-row-actions">
        {a.status !== "done" && (
          <button type="button" className="alv-icon" onClick={() => onPause(a.status !== "paused")} aria-label={a.status === "paused" ? w.resumeAlert : w.pauseAlert} title={a.status === "paused" ? w.resume : w.pause}>
            {a.status === "paused" ? <Play /> : <Pause />}
          </button>
        )}
        <button
          type="button"
          className={`alv-icon is-danger${confirm ? " is-armed" : ""}`}
          onBlur={() => setConfirm(false)}
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
          aria-label={confirm ? w.clickAgain : w.deleteAlert}
          title={confirm ? w.clickAgain : t.common.delete}
        >
          <Trash />
        </button>
      </div>
    </article>
  );
}
