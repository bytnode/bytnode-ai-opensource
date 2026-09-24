"use client";

import { useState, type ReactNode } from "react";
import { runConversationId } from "@/lib/plugins/scheduler/tasks";
import type { Scheduled } from "@/lib/plugins/scheduler/timeline";
import { relative } from "@/lib/plugins/scheduler/timeline";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { Refresh } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { Composer } from "./composer";
import type { SchedulerState } from "./format";
import { Jobs, Runs, Tasks } from "./lists";
import { Timeline } from "./timeline";
import "../watchlist/watchlist.css";
import "./scheduler.css";

/* ---------------------------------------------------------------------------
   The Scheduled tasks tab, in the bare views' language (the watchlist's
   sheet, the calendar's tokens) — one sheet, no side column. Top to
   bottom: what is scheduled, said in one line; the next 24 hours as a
   timeline (`timeline.tsx`); "Schedule a task" (`composer.tsx`); the agent
   tasks, as tiles; the plugins' background jobs; the recent runs (a
   finished task opens as its conversation).

   The runs happen on the server: the tab reads again every 10 s while it is
   in front, and at once after an action. Every relative time is read
   against the server's `at`, never the render's clock.
--------------------------------------------------------------------------- */

const REFRESH = 10_000;

export function SchedulerView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<SchedulerState>("scheduler", "state", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, REFRESH);
  const [problem, setProblem] = useState<string | null>(null);
  const agents = settings.agents;
  const now = data?.at ? Date.parse(data.at) : null;

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

  const items: Scheduled[] = data
    ? [
        ...data.tasks.map((t) => ({ id: `task:${t.id}`, title: t.title, every: t.frequency, kind: "task" as const, paused: t.status === "paused", nextRun: t.state.nextRun })),
        ...data.jobs.map((j) => ({ id: j.id, title: j.title, every: j.every, kind: "job" as const, nextRun: j.state.nextRun })),
      ]
    : [];
  const active = data?.tasks.filter((t) => t.status === "active") ?? [];
  const soonest = data && now !== null ? active.map((t) => t.state.nextRun).filter((x): x is string => Boolean(x)).sort()[0] : undefined;
  const running = (data?.tasks.filter((t) => t.running).length ?? 0) + (data?.jobs.filter((j) => j.running).length ?? 0);
  const summary = !data
    ? "Reading the schedule…"
    : `${data.tasks.length ? `${data.tasks.length} agent task${data.tasks.length === 1 ? "" : "s"}` : "No agent task yet"}${data.tasks.length - active.length ? ` (${data.tasks.length - active.length} paused)` : ""}, ${data.jobs.length} plugin job${data.jobs.length === 1 ? "" : "s"}${soonest && now !== null ? ` — the next task ${relative(soonest, now)}` : ""}. Everything runs only while BytNode-AI is open in a tab.`;

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
            <span className={`wlv-status${data && !loading && !error ? " is-live" : ""}`}>{running ? `${running} running` : data ? `Updated ${new Date(data.at).toLocaleTimeString("en-GB")}` : "Loading…"}</span>
            <button type="button" className="wlv-icon" onClick={reload} aria-label="Read the schedule again" title="Read the schedule again">
              <Refresh />
            </button>
          </header>
          {(problem ?? error) && <p className="wlv-problem">{problem ?? error}</p>}

          <div className="wlv-body">
            <div className="sdv-inner">
              {data && now !== null && <Timeline items={items} now={now} />}

              <Composer agents={agents} now={now} onCreate={(task) => run("create", task)} />
              <p className="sdv-note">Times are this computer&apos;s. A scheduled agent works with a sub-agent&apos;s tools: it never places an order or moves funds. Each run uses the agent&apos;s model, or its subscription.</p>

              {data && now !== null && (
                <>
                  <Section title="Agent tasks" sub="what your agents do on their own">
                    <Tasks tasks={data.tasks} agents={agents} now={now} onAct={run} />
                  </Section>
                  <Section title="Background jobs" sub="the plugins' own work">
                    <Jobs jobs={data.jobs} now={now} onAct={run} />
                  </Section>
                  <Section title="Recent runs" sub="newest first">
                    <Runs runs={data.runs} now={now} onOpen={(id) => void openRun(id)} />
                  </Section>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="sdv-section" aria-label={title}>
      <p className="wlv-section-title">
        <span className="pv-ink">{title}</span>
        <small>{sub}</small>
      </p>
      {children}
    </section>
  );
}
