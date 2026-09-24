"use client";

import { useState } from "react";
import type { AgentConfig } from "@/lib/domain/types";
import { findAgent, taskKey } from "@/lib/plugins/scheduler/tasks";
import { frequencyText, relative } from "@/lib/plugins/scheduler/timeline";
import { Switch } from "@/components/ui/switch";
import { ChevronRight } from "@/components/ui/icons";
import { hueOf, type RunRow, type TaskRow } from "./format";

/* ---------------------------------------------------------------------------
   The agent tasks, and what they produced.

   A task is one quiet row, like a reminder: its name; under it its pace,
   the agent that runs it (its initial in the agent's colour) and how the
   last run went; on the right when it runs next, and a switch — on, it
   runs; off, it is paused. A click on the row unfolds what it asks and its
   two other actions: run it now, delete it. The recent runs are rows too,
   newest first: a finished task opens as its conversation, a failure says
   why.
--------------------------------------------------------------------------- */

type Act = (action: string, params: Record<string, unknown>) => Promise<string | null>;

export function Tasks({ tasks, agents, now, onAct }: { tasks: TaskRow[]; agents: AgentConfig[]; now: number; onAct: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: string, params: Record<string, unknown>) => {
    setBusy(key);
    await onAct(action, params);
    setBusy(null);
  };
  return (
    <ul className="sdv-rows">
      {tasks.map((t) => {
        const name = findAgent(agents, t.agent)?.name ?? t.agent;
        const paused = t.status === "paused";
        const unfolded = open === t.id;
        const s = t.state;
        return (
          <li key={t.id} className={`sdv-task${paused ? " is-paused" : ""}${unfolded ? " is-open" : ""}`}>
            <div className="sdv-task-row">
              <button type="button" className="sdv-task-main" aria-expanded={unfolded} onClick={() => setOpen(unfolded ? null : t.id)}>
                <span className="sdv-task-name">
                  <b>{t.title}</b>
                  <small>
                    {frequencyText(t.frequency)}
                    <span className="sdv-agent">
                      <i style={{ background: hueOf(name) }}>{name.charAt(0).toUpperCase()}</i>
                      {name}
                    </span>
                    {s.lastRun && <span className={s.lastStatus === "failed" ? "is-failed" : "is-ok"}>{s.lastStatus === "failed" ? `failed ${relative(s.lastRun, now)}` : `ran ${relative(s.lastRun, now)}`}</span>}
                  </small>
                </span>
                <span className="sdv-task-next">{t.running ? <b className="is-running">Running</b> : paused ? "Paused" : relative(s.nextRun, now)}</span>
              </button>
              <Switch on={!paused} onChange={(on) => void run(`switch:${t.id}`, "update", { id: t.id, action: on ? "resume" : "pause" })} label={paused ? `Resume ${t.title}` : `Pause ${t.title}`} disabled={busy !== null} />
            </div>
            {unfolded && (
              <div className="sdv-task-more">
                <p className="sdv-task-prompt">{t.prompt}</p>
                {s.lastStatus === "failed" && s.lastMessage && <p className="sdv-task-error">Last run failed: {s.lastMessage}</p>}
                <div className="sdv-task-actions">
                  <button type="button" className="sdv-link" disabled={t.running || busy !== null} onClick={() => void run(`now:${t.id}`, "run-now", { id: taskKey(t.id) })}>
                    {busy === `now:${t.id}` ? "Starting…" : "Run now"}
                  </button>
                  <button type="button" className="sdv-link is-danger" disabled={busy !== null} onClick={() => void run(`del:${t.id}`, "update", { id: t.id, action: "delete" })}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const SHOWN_RUNS = 5;

/** A report's first lines as one line, without their Markdown — a
    heading reads as the start of its sentence. */
const plain = (text: string) =>
  text
    .replace(/^#{1,6}\s*(.*)$/gm, "$1:")
    .replace(/[*_`]+/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();

export function Runs({ runs, now, onOpen }: { runs: RunRow[]; now: number; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className="sdv-rows">
        {(all ? runs : runs.slice(0, SHOWN_RUNS)).map((r) => {
          const opens = r.ok && Boolean(r.agentId);
          const body = (
            <>
              <span className={`sdv-dot ${r.ok ? "is-ok" : "is-failed"}`} aria-hidden />
              <span className="sdv-run-name">
                <b>
                  {r.title}
                  <small>{relative(r.finishedAt, now)}</small>
                </b>
                <span className={`sdv-run-text${r.ok ? "" : " is-failed"}`}>{r.ok ? (r.excerpt ? plain(r.excerpt) : "Done.") : (r.error ?? "Failed.")}</span>
              </span>
              {opens && <ChevronRight />}
            </>
          );
          return (
            <li key={r.id}>
              {opens ? (
                <button type="button" className="sdv-run is-link" onClick={() => onOpen(r.id)} title="Open the report as a conversation">
                  {body}
                </button>
              ) : (
                <div className="sdv-run">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {runs.length > SHOWN_RUNS && (
        <button type="button" className="sdv-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${runs.length}`}
        </button>
      )}
    </>
  );
}
