"use client";

import { useEffect, useState } from "react";
import { isFrequency } from "@/lib/plugins/core/frequency";
import { runConversationId, shortDate, taskKey, type AgentTask, type RunRecord, type RunState } from "@/lib/plugins/scheduler/tasks";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { Select } from "@/components/ui/select";
import { Plus, Refresh, Trash } from "@/components/ui/icons";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { Loading, Problem } from "../bits";

/* ---------------------------------------------------------------------------
   The Scheduled tasks tab: the user's agent tasks (created here or by an
   agent through TaskSchedule), the plugins' background jobs, and what ran
   lately — a finished task opens as its conversation.
--------------------------------------------------------------------------- */

type TaskRow = AgentTask & { state: RunState; running: boolean };
type JobRow = { id: string; owner: string; title: string; every: string; running: boolean; state: RunState };
type RunRow = Omit<RunRecord, "text"> & { excerpt?: string };
type State = { tasks: TaskRow[]; jobs: JobRow[]; runs: RunRow[] };

/** The runs happen on the server: the tab looks again now and then. */
const REFRESH = 10_000;

const FREQUENCY_HINT = "every 30 minutes · every 4 hours · daily at 08:00 · every monday at 09:30";

function Last({ state }: { state: RunState }) {
  if (!state.lastRun) return <span className="pv-muted">never</span>;
  return (
    <span className={state.lastStatus === "failed" ? "pv-down" : undefined} title={state.lastMessage}>
      {shortDate(state.lastRun)}
      {state.lastStatus === "failed" ? " · failed" : ""}
    </span>
  );
}

export function SchedulerView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<State>("scheduler", "state", settings);
  const agents = settings.agents;
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState(agents[0]?.id ?? "");
  const [frequency, setFrequency] = useState("daily at 08:00");
  const [prompt, setPrompt] = useState("");
  const [catchUp, setCatchUp] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(reload, REFRESH);
    return () => clearInterval(t);
  }, [reload]);

  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("scheduler", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };

  const create = async () => {
    const p = await run("create", { title, agent, frequency, prompt, catchUp: catchUp ? "run-once-on-start" : "skip" });
    if (p) return;
    setTitle("");
    setPrompt("");
  };

  const openRun = async (id: string) => {
    const conversation = runConversationId(id);
    await ensureConversation(conversation, settings);
    goToConversation(conversation);
  };

  const agentName = (ref: string) => agents.find((a) => a.id === ref)?.name ?? ref;
  const ready = title.trim() && prompt.trim() && agent && isFrequency(frequency);

  return (
    <>
      <form
        className="pv-form sv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="sv-title">
            Task
          </label>
          <input id="sv-title" className="field-input" placeholder="Morning market brief" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sv-agent">
            Agent
          </label>
          <Select id="sv-agent" label="Agent" value={agent} options={agents.map((a) => ({ value: a.id, label: a.name }))} onChange={setAgent} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sv-frequency">
            When
          </label>
          <input id="sv-frequency" className="field-input" placeholder={FREQUENCY_HINT} title={FREQUENCY_HINT} value={frequency} onChange={(e) => setFrequency(e.target.value)} aria-invalid={!isFrequency(frequency)} />
        </div>
        <div className="field sv-prompt">
          <label className="field-label" htmlFor="sv-prompt">
            Instructions
          </label>
          <textarea id="sv-prompt" className="field-input" rows={3} placeholder="Summarise the overnight moves of my watchlist, the funding rates, and the events of the day. Sources and times for every figure." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <label className="sv-check">
          <input type="checkbox" checked={catchUp} onChange={(e) => setCatchUp(e.target.checked)} />
          If a run was missed while the app was closed, run it once when it opens
        </label>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          <Plus />
          Schedule
        </button>
      </form>
      <p className="pv-note">Times are this computer&apos;s. Tasks run only while BytNode-AI is open in a tab, with a sub-agent&apos;s tools: a scheduled agent never places an order or moves funds. Each run uses the agent&apos;s model (or its subscription).</p>
      {problem && <Problem message={problem} />}
      {error && <Problem message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="pv-section">
            <h2 className="pv-section-title">
              Agent tasks
              {loading && <span className="pv-chip">Updating…</span>}
            </h2>
            {data.tasks.length === 0 ? (
              <p className="pv-note">No task yet. Create one above, or ask an agent: &quot;give me a market brief every morning at 8&quot;.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Agent</th>
                      <th>When</th>
                      <th>Last run</th>
                      <th>Next run</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((t) => (
                      <tr key={t.id}>
                        <td title={t.prompt}>
                          <strong>{t.title}</strong>
                          {t.status === "paused" && <span className="pv-chip pv-tag">paused</span>}
                          {t.running && <span className="pv-chip pv-tag">running…</span>}
                        </td>
                        <td>{agentName(t.agent)}</td>
                        <td className="pv-muted">{t.frequency}</td>
                        <td>
                          <Last state={t.state} />
                        </td>
                        <td className="pv-muted">{t.status === "paused" ? "—" : shortDate(t.state.nextRun)}</td>
                        <td className="pv-actions">
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run("run-now", { id: taskKey(t.id) })} disabled={t.running}>
                            Run now
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run("update", { id: t.id, action: t.status === "paused" ? "resume" : "pause" })}>
                            {t.status === "paused" ? "Resume" : "Pause"}
                          </button>
                          <button type="button" className="st-icon" onClick={() => void run("update", { id: t.id, action: "delete" })} aria-label={`Delete ${t.title}`} title="Delete">
                            <Trash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pv-section">
            <h2 className="pv-section-title">Background jobs of the plugins</h2>
            {data.jobs.length === 0 ? (
              <p className="pv-note">No plugin has background work right now.</p>
            ) : (
              <div className="pv-table-wrap">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Plugin</th>
                      <th>When</th>
                      <th>Last run</th>
                      <th>Next run</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>
                          <strong>{j.title}</strong>
                          {j.running && <span className="pv-chip pv-tag">running…</span>}
                        </td>
                        <td className="pv-muted">{j.owner}</td>
                        <td className="pv-muted">{j.every}</td>
                        <td>
                          <Last state={j.state} />
                        </td>
                        <td className="pv-muted">{shortDate(j.state.nextRun)}</td>
                        <td className="pv-actions">
                          <button type="button" className="st-icon" onClick={() => void run("run-now", { id: j.id })} disabled={j.running} aria-label={`Run ${j.title} now`} title="Run now">
                            <Refresh />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pv-section">
            <h2 className="pv-section-title">Recent runs</h2>
            {data.runs.length === 0 ? (
              <p className="pv-note">Nothing has run yet. Finished tasks and failed jobs are listed here.</p>
            ) : (
              <ul className="sv-runs">
                {data.runs.map((r) => (
                  <li key={r.id}>
                    <div className="sv-run-head">
                      <strong>{r.title}</strong>
                      <span className="pv-muted">{shortDate(r.finishedAt)}</span>
                      {r.ok ? <span className="pv-chip">done</span> : <span className="pv-chip pv-down">failed</span>}
                      {r.ok && r.kind === "task" && r.agentId && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void openRun(r.id)}>
                          Open the conversation
                        </button>
                      )}
                    </div>
                    <p className={`sv-run-body${r.ok ? "" : " pv-down"}`}>{r.ok ? r.excerpt : r.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
