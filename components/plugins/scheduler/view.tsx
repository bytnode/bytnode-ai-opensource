"use client";

import { useState, type ReactNode } from "react";
import { runConversationId } from "@/lib/plugins/scheduler/tasks";
import { relative, type Scheduled } from "@/lib/plugins/scheduler/timeline";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { Refresh } from "@/components/ui/icons";
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

  const items: Scheduled[] = tasks.map((t) => ({ id: t.id, title: t.title, every: t.frequency, kind: "task" as const, paused: t.status === "paused", nextRun: t.state.nextRun }));
  const active = tasks.filter((t) => t.status === "active");
  const soonest = active.map((t) => t.state.nextRun).filter((x): x is string => Boolean(x)).sort()[0];
  const running = tasks.filter((t) => t.running).length;
  const summary = !data
    ? "Reading the schedule…"
    : tasks.length === 0
      ? "An agent that works on its own, at the pace you choose — while BytNode-AI is open in a tab."
      : `${active.length} active${tasks.length > active.length ? `, ${tasks.length - active.length} paused` : ""}${soonest && now !== null ? ` — the next one ${relative(soonest, now)}` : ""}.`;

  return (
    <div className="wlv sdv">
      <div className="wlv-panel">
        <main className="wlv-pane wlv-sheet sdv-sheet">
          <header className="wlv-head">
            <div className="wlv-title-block">
              <h2 className="wlv-sheet-title">
                <span className="pv-ink">Scheduled tasks</span>
              </h2>
              <p className="wlv-sheet-sub">{summary}</p>
            </div>
            <span className={`wlv-status${running ? " is-live" : ""}`}>{running ? `${running} running` : data ? `Updated ${new Date(data.at).toLocaleTimeString("en-GB")}` : "Loading…"}</span>
            <button type="button" className="wlv-icon" onClick={reload} aria-label="Read the schedule again" title="Read the schedule again">
              <Refresh />
            </button>
          </header>
          {(problem ?? error) && <p className="wlv-problem">{problem ?? error}</p>}

          <div className="wlv-body">
            <div className="sdv-inner">
              {now !== null && tasks.length > 0 && <Timeline items={items} now={now} />}
              <Composer open={open} onOpen={setComposing} agents={agents} now={now} onCreate={(task) => run("create", task)} />

              {data && now !== null && tasks.length > 0 && (
                <Section title="Tasks">
                  <Tasks tasks={tasks} agents={agents} now={now} onAct={run} />
                </Section>
              )}
              {data && now !== null && data.runs.length > 0 && (
                <Section title="Recent runs">
                  <Runs runs={data.runs} now={now} onOpen={(id) => void openRun(id)} />
                </Section>
              )}
              <p className="sdv-foot">Times are this computer&apos;s. A scheduled agent has a sub-agent&apos;s tools — it never places an order or moves funds — and each run uses its model, or its subscription.</p>
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
