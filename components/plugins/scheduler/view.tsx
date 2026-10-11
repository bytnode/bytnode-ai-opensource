"use client";

import { useState, type ReactNode } from "react";
import { runConversationId } from "@/lib/plugins/scheduler/tasks";
import { relative, type Scheduled } from "@/lib/plugins/scheduler/timeline";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { Refresh } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { Composer } from "./composer";
import type { SchedulerState } from "./format";
import { Runs, Tasks } from "./lists";
import { Timeline } from "./timeline";
import "../watchlist/watchlist.css";
import "./scheduler.css";

/* ---------------------------------------------------------------------------
   The Scheduled tasks tab: the agent tasks — an agent that works on its
   own at a pace — and nothing else (the plugins' background jobs are their
   own machinery, not shown here). In the bare views' language, one sheet,
   no side column. Top to bottom: what is scheduled in one line; the next
   24 hours (`timeline.tsx`, when there is a task); "New scheduled task"
   (`composer.tsx`, folded until wanted); the tasks; the recent runs (a
   finished one opens as its conversation).

   The runs happen on the server: the tab reads again every 10 s while it is
   in front, and at once after an action. Every relative time is read
   against the server's `at`, never the render's clock.
--------------------------------------------------------------------------- */

const REFRESH = 10_000;

export function SchedulerView({ settings }: ViewProps) {
  const t = useMessages();
  const w = t.scheduler;
  const { data, error, reload } = usePluginData<SchedulerState>("scheduler", "state", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, REFRESH);
  const [problem, setProblem] = useState<string | null>(null);
  const [composing, setComposing] = useState<boolean | null>(null);
  const agents = settings.agents;
  const now = data?.at ? Date.parse(data.at) : null;
  const tasks = data?.tasks ?? [];
  /* The composer is open from the start while there is nothing yet. */
  const open = composing ?? (data !== undefined && tasks.length === 0);

  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("scheduler", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };
  const openRun = async (id: string) => {
    const conversation = runConversationId(id);
    await ensureConversation(conversation, settings);
    goToConversation(conversation);
  };

  const items: Scheduled[] = tasks.map((task) => ({ id: task.id, title: task.title, every: task.frequency, kind: "task" as const, paused: task.status === "paused", nextRun: task.state.nextRun }));
  const active = tasks.filter((task) => task.status === "active");
  const soonest = active.map((task) => task.state.nextRun).filter((x): x is string => Boolean(x)).sort()[0];
  const running = tasks.filter((task) => task.running).length;
  const summary = !data ? w.readingSchedule : tasks.length === 0 ? w.intro : w.summary(active.length, tasks.length - active.length, soonest && now !== null ? relative(soonest, now) : null);

  return (
    <div className="wlv sdv">
      <div className="wlv-panel">
        <main className="wlv-pane wlv-sheet sdv-sheet">
          <header className="wlv-head">
            <div className="wlv-title-block">
              <h2 className="wlv-sheet-title">
                <span className="pv-ink">{w.title}</span>
              </h2>
              <p className="wlv-sheet-sub">{summary}</p>
            </div>
            <span className={`wlv-status${running ? " is-live" : ""}`}>{running ? w.running(running) : data ? w.updated(new Date(data.at).toLocaleTimeString(dateTag())) : t.common.loading}</span>
            <button type="button" className="wlv-icon" onClick={reload} aria-label={w.readAgain} title={w.readAgain}>
              <Refresh />
            </button>
          </header>
          {(problem ?? error) && <p className="wlv-problem">{problem ?? error}</p>}

          <div className="wlv-body">
            <div className="sdv-inner">
              {now !== null && tasks.length > 0 && <Timeline items={items} now={now} />}
              <Composer open={open} onOpen={setComposing} agents={agents} bots={settings.keys.telegram} now={now} onCreate={(task) => run("create", task)} />

              {data && now !== null && tasks.length > 0 && (
                <Section title={w.tasks}>
                  <Tasks tasks={tasks} agents={agents} bots={settings.keys.telegram} now={now} onAct={run} />
                </Section>
              )}
              {data && now !== null && data.runs.length > 0 && (
                <Section title={w.recentRuns}>
                  <Runs runs={data.runs} now={now} onOpen={(id) => void openRun(id)} onDelete={(id) => void run("delete-run", { id })} />
                </Section>
              )}
              <p className="sdv-foot">{w.foot}</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sdv-section" aria-label={title}>
      <p className="wlv-section-title">
        <span className="pv-ink">{title}</span>
      </p>
      {children}
    </section>
  );
}
