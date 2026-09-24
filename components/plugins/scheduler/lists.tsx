"use client";

import { useState } from "react";
import type { AgentConfig } from "@/lib/domain/types";
import { frequencyText, relative } from "@/lib/plugins/scheduler/timeline";
import { taskKey } from "@/lib/plugins/scheduler/tasks";
import { ChevronRight, Refresh, Trash } from "@/components/ui/icons";
import { hueOf, outcomeOf, pluginName, type JobRow, type RunRow, type TaskRow } from "./format";

/* ---------------------------------------------------------------------------
   What is scheduled, and what ran.

   The agent tasks are tiles of one block: how often, who runs it (its
   initial in the agent's colour), the task's name, what it asks, then when
   it runs next and how its last run went — and its three actions: run it
   now, pause or resume it, delete it. A paused one fades; a running one
   says so. The plugins' jobs are rows: the plugin, the job, its pace, how
   its last run went and when the next comes; each can be run now. The
   recent runs are rows too, newest first: a finished task opens as its
   conversation, a failure says why.
--------------------------------------------------------------------------- */

type Act = (action: string, params: Record<string, unknown>) => Promise<string | null>;

function Outcome({ state, now }: { state: TaskRow["state"]; now: number }) {
  const cls = outcomeOf(state);
  return (
    <span className={`sdv-outcome ${cls}`} title={state.lastMessage}>
      <i />
      {state.lastRun ? `${state.lastStatus === "failed" ? "Failed" : "Ran"} ${relative(state.lastRun, now)}` : "Never ran"}
    </span>
  );
}

export function Tasks({ tasks, agents, now, onAct }: { tasks: TaskRow[]; agents: AgentConfig[]; now: number; onAct: Act }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: string, params: Record<string, unknown>) => {
    setBusy(key);
    await onAct(action, params);
    setBusy(null);
  };
  if (tasks.length === 0) {
    return <p className="sdv-empty">No agent task yet. Schedule one above, or ask an agent: “give me a market brief every morning at 8”.</p>;
  }
  return (
    <ul className="sdv-tasks">
      {tasks.map((t) => {
        const agent = agents.find((a) => a.id === t.agent || a.name.toLowerCase() === t.agent.toLowerCase());
        const name = agent?.name ?? t.agent;
        const paused = t.status === "paused";
        return (
          <li key={t.id} className={`sdv-task${paused ? " is-paused" : ""}${t.running ? " is-running" : ""}`}>
            <div className="sdv-task-top">
              <span className="sdv-freq">{frequencyText(t.frequency)}</span>
              {t.running && <span className="sdv-badge is-running">Running</span>}
              {paused && <span className="sdv-badge">Paused</span>}
              <span className="sdv-agent-chip" title={agent ? `Run by ${name}` : `Agent "${name}" not found`}>
                <i style={{ background: hueOf(name) }}>{name.charAt(0).toUpperCase()}</i>
                {name}
              </span>
            </div>
            <p className="sdv-task-title">{t.title}</p>
            <p className="sdv-task-prompt" title={t.prompt}>
              {t.prompt}
            </p>
            <div className="sdv-task-foot">
              <span className="sdv-task-when">
                <b>{paused ? "Paused" : t.running ? "Running now" : `Next ${relative(t.state.nextRun, now)}`}</b>
                <Outcome state={t.state} now={now} />
              </span>
              <span className="sdv-task-actions">
                <button type="button" className="sdv-pill" disabled={t.running || busy !== null} onClick={() => void run(`now:${t.id}`, "run-now", { id: taskKey(t.id) })}>
                  {busy === `now:${t.id}` ? "Starting…" : "Run now"}
                </button>
                <button type="button" className="sdv-pill" disabled={busy !== null} onClick={() => void run(`pause:${t.id}`, "update", { id: t.id, action: paused ? "resume" : "pause" })}>
                  {paused ? "Resume" : "Pause"}
                </button>
                <button type="button" className="wlv-icon sdv-delete" disabled={busy !== null} onClick={() => void run(`del:${t.id}`, "update", { id: t.id, action: "delete" })} aria-label={`Delete ${t.title}`} title="Delete the task">
                  <Trash />
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Jobs({ jobs, now, onAct }: { jobs: JobRow[]; now: number; onAct: Act }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (jobs.length === 0) return <p className="sdv-empty">No plugin has background work right now.</p>;
  return (
    <ul className="sdv-rows">
      {jobs.map((j) => {
        const plugin = pluginName(j.owner);
        return (
          <li key={j.id} className="sdv-row sdv-job">
            <i className="sdv-plugin" style={{ background: hueOf(j.owner) }} aria-hidden>
              {plugin.charAt(0)}
            </i>
            <span className="sdv-row-name">
              <b>{j.title}</b>
              <small>
                {plugin} · {frequencyText(j.every)}
              </small>
            </span>
            <span className="sdv-row-meta">
              {j.running ? <span className="sdv-badge is-running">Running</span> : <Outcome state={j.state} now={now} />}
              {j.state.nextRun && <small>Next {relative(j.state.nextRun, now)}</small>}
            </span>
            <button
              type="button"
              className="wlv-icon"
              disabled={j.running || busy !== null}
              onClick={async () => {
                setBusy(j.id);
                await onAct("run-now", { id: j.id });
                setBusy(null);
              }}
              aria-label={`Run ${j.title} now`}
              title="Run now"
            >
              <Refresh />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const SHOWN_RUNS = 8;

/** A report's first lines without their Markdown: headings, emphasis, code. */
const plain = (text: string) =>
  text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

export function Runs({ runs, now, onOpen }: { runs: RunRow[]; now: number; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  if (runs.length === 0) return <p className="sdv-empty">Nothing has run yet. Finished tasks, and jobs that failed, are listed here.</p>;
  return (
    <>
      <ul className="sdv-rows">
        {(all ? runs : runs.slice(0, SHOWN_RUNS)).map((r) => {
          const opens = r.ok && r.kind === "task" && Boolean(r.agentId);
          const body = (
            <>
              <span className={`sdv-dot ${r.ok ? "is-ok" : "is-failed"}`} aria-hidden />
              <span className="sdv-row-name">
                <b>
                  {r.title}
                  <small>{relative(r.finishedAt, now)}</small>
                </b>
                <span className={`sdv-run-text${r.ok ? "" : " is-failed"}`}>{r.ok ? (r.excerpt ? plain(r.excerpt) : "Done.") : (r.error ?? "Failed.")}</span>
              </span>
              {opens && (
                <span className="sdv-open">
                  Open
                  <ChevronRight />
                </span>
              )}
            </>
          );
          return (
            <li key={r.id}>
              {opens ? (
                <button type="button" className="sdv-row sdv-run is-link" onClick={() => onOpen(r.id)} title="Open the conversation of this run">
                  {body}
                </button>
              ) : (
                <div className="sdv-row sdv-run">{body}</div>
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
