"use client";

import { useState } from "react";
import type { AgentConfig, TelegramBot } from "@/lib/domain/types";
import { findAgent } from "@/lib/plugins/scheduler/tasks";
import { frequencyText, relative } from "@/lib/plugins/scheduler/timeline";
import { Switch } from "@/components/ui/switch";
import { ChevronRight, Trash } from "@/components/ui/icons";
import { hueOf, type RunRow, type TaskRow } from "./format";
import { TelegramPick } from "./telegram-pick";
import { useMessages } from "@/lib/i18n/react";

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

export function Tasks({ tasks, agents, bots, now, onAct }: { tasks: TaskRow[]; agents: AgentConfig[]; bots: TelegramBot[]; now: number; onAct: Act }) {
  const t = useMessages();
  const w = t.scheduler.list;
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* The trash beside the switch (user request, 2026-10-08): the switch
     pauses, the trash deletes for good — at once, no confirmation (the
     user's choice). */
  const run = async (key: string, action: string, params: Record<string, unknown>) => {
    setBusy(key);
    await onAct(action, params);
    setBusy(null);
  };
  return (
    <ul className="sdv-rows">
      {tasks.map((task) => {
        const name = findAgent(agents, task.agent)?.name ?? task.agent;
        const paused = task.status === "paused";
        const unfolded = open === task.id;
        const s = task.state;
        return (
          <li key={task.id} className={`sdv-task${paused ? " is-paused" : ""}${unfolded ? " is-open" : ""}`}>
            <div className="sdv-task-row">
              <button type="button" className="sdv-task-main" aria-expanded={unfolded} onClick={() => setOpen(unfolded ? null : task.id)}>
                <span className="sdv-task-name">
                  <b>{task.title}</b>
                  <small>
                    {frequencyText(task.frequency)}
                    <span className="sdv-agent">
                      <i style={{ background: hueOf(name) }}>{name.charAt(0).toUpperCase()}</i>
                      {name}
                    </span>
                    {s.lastRun && <span className={s.lastStatus === "failed" ? "is-failed" : "is-ok"}>{s.lastStatus === "failed" ? w.failed(relative(s.lastRun, now)) : w.ran(relative(s.lastRun, now))}</span>}
                  </small>
                </span>
                <span className="sdv-task-next">{task.running ? <b className="is-running">{w.running}</b> : paused ? w.paused : relative(s.nextRun, now)}</span>
              </button>
              <Switch on={!paused} onChange={(on) => void run(`switch:${task.id}`, "update", { id: task.id, action: on ? "resume" : "pause" })} label={paused ? w.resume(task.title) : w.pause(task.title)} disabled={busy !== null} />
              <button type="button" className="sdv-trash" disabled={busy !== null} onClick={() => void run(`del:${task.id}`, "update", { id: task.id, action: "delete" })} aria-label={w.delete(task.title)} title={t.common.delete}>
                <Trash />
              </button>
            </div>
            {unfolded && (
              <div className="sdv-task-more">
                <p className="sdv-task-prompt">{task.prompt}</p>
                {s.lastStatus === "failed" && s.lastMessage && <p className="sdv-task-error">{w.lastFailed(s.lastMessage)}</p>}
                <div className="sdv-task-telegram">
                  <span className="sdv-label">Telegram</span>
                  <TelegramPick
                    id={`sdv-tg-${task.id}`}
                    bots={bots}
                    disabled={busy !== null}
                    value={{ bot: task.telegram?.bot ?? "", report: task.telegram?.report ?? "full" }}
                    onChange={(v) => void run(`tg:${task.id}`, "telegram", { id: task.id, bot: v.bot, report: v.report })}
                  />
                </div>
                <div className="sdv-task-actions">
                  <button type="button" className="sdv-link" disabled={task.running || busy !== null} onClick={() => void run(`now:${task.id}`, "run-now", { id: task.id })}>
                    {busy === `now:${task.id}` ? w.starting : w.runNow}
                  </button>
                  <button type="button" className="sdv-link is-danger" disabled={busy !== null} onClick={() => void run(`del:${task.id}`, "update", { id: task.id, action: "delete" })}>
                    {t.common.delete}
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

export function Runs({ runs, now, onOpen, onDelete }: { runs: RunRow[]; now: number; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const t = useMessages();
  const w = t.scheduler.list;
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
                <span className={`sdv-run-text${r.ok ? "" : " is-failed"}`}>{r.ok ? (r.excerpt ? plain(r.excerpt) : w.done) : (r.error ?? w.failedRun)}</span>
              </span>
              {opens && <ChevronRight />}
            </>
          );
          return (
            <li key={r.id} className="sdv-run-line">
              {opens ? (
                <button type="button" className="sdv-run is-link" onClick={() => onOpen(r.id)} title={w.openReport}>
                  {body}
                </button>
              ) : (
                <div className="sdv-run">{body}</div>
              )}
              {/* Deleted at once, like a task (user request). */}
              <button type="button" className="sdv-trash" onClick={() => onDelete(r.id)} aria-label={w.deleteRun(r.title)} title={t.common.delete}>
                <Trash />
              </button>
            </li>
          );
        })}
      </ul>
      {runs.length > SHOWN_RUNS && (
        <button type="button" className="sdv-more" onClick={() => setAll(!all)}>
          {all ? w.showFewer : w.showAll(runs.length)}
        </button>
      )}
    </>
  );
}
