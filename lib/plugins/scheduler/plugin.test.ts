import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { JOBS, RUNS } from "../core/clock";
import { definePlugin, type Session } from "../core/contract";
import { pluginStore } from "../core/store";
import { manifest } from "../core/test-fixture";
import { harness, type Harness } from "../test-fixture";
import { runAgentInBackground } from "./agent-runner";
import { taskKey, type AgentTask, type RunRecord, type RunState } from "./tasks";
import { schedulerPlugin } from ".";

vi.mock("./agent-runner", () => ({ runAgentInBackground: vi.fn() }));

const SESSION = { agents: [{ id: "a1", name: "Analyst" }] as AgentConfig[] } as Session;

/* A plugin with a job on the core's clock, as the portfolio or the alerts. */
const user = definePlugin({
  manifest: manifest("user"),
  setup(ctx) {
    ctx.job({ id: "refresh", title: "User refresh", every: "every 10 minutes", run: async () => "ok" });
  },
});

const at = (h: number, m = 0, d = 23) => new Date(2026, 8, d, h, m).getTime();
const task = (over: Partial<AgentTask> = {}): AgentTask => ({ id: "t1", title: "Morning brief", prompt: "Brief me.", agent: "Analyst", frequency: "every 1 hour", catchUp: "skip", status: "active", createdAt: "", ...over });

beforeEach(() => {
  vi.mocked(runAgentInBackground).mockReset();
  vi.mocked(runAgentInBackground).mockResolvedValue({ ok: true, text: "## Brief\nBTC is up 2 %." });
});

const api = (h: Harness, action: string, params: Record<string, unknown> = {}) =>
  h.runtime.handler("scheduler", action)!(params, { transport: { openrouterKey: "", bytnodeKey: "", exchangeAccounts: [], plugins: null }, signal: new AbortController().signal });

let h: Harness;
afterEach(async () => h?.close());

describe("scheduler plugin", () => {
  it("schedules, lists, pauses and deletes an agent task", async () => {
    h = await harness([schedulerPlugin]);
    h.session.current = SESSION;
    const created = await h.tool("TaskSchedule").execute({ title: "Morning brief", prompt: "Brief me on BTC.", frequency: "daily at 08:00", runMissed: true }, h.ctx({ agentId: "a1" }));
    expect(created.ok).toBe(true);
    expect(created.output).toMatch(/^Scheduled "Morning brief" \[\w+\]: Analyst, daily at 08:00\./);
    expect(created.card).toMatchObject({ kind: "facts", data: { rows: expect.arrayContaining([{ label: "Missed runs", value: "run once when the app opens" }]) } });

    const listed = await h.tool("TaskList").execute({}, h.ctx());
    expect(listed.output).toMatch(/- Morning brief \[\w+\] — agent a1, daily at 08:00; never run; next —/);

    expect((await h.tool("TaskCancel").execute({ task: "morning brief", action: "pause" }, h.ctx())).output).toMatch(/paused\.$/);
    expect((await h.tool("TaskList").execute({}, h.ctx())).output).toMatch(/never run; paused/);
    expect((await h.tool("TaskCancel").execute({ task: "Morning brief" }, h.ctx())).output).toMatch(/deleted\.$/);
    expect((await h.tool("TaskList").execute({}, h.ctx())).output).toMatch(/^No scheduled agent task\./);
    expect((await h.tool("TaskCancel").execute({ task: "Morning brief" }, h.ctx())).ok).toBe(false);
  });

  it("checks the agent where the agents are known, trusts the name where they are not", async () => {
    h = await harness([schedulerPlugin]);
    h.session.current = SESSION;
    const unknown = await h.tool("TaskSchedule").execute({ title: "x", prompt: "x", frequency: "every hour", agent: "Trader" }, h.ctx());
    expect(unknown).toMatchObject({ ok: false, output: 'No agent "Trader". The agents are: Analyst.' });
    /* The MCP server of a subscription session has no session. */
    h.session.current = null;
    expect((await h.tool("TaskSchedule").execute({ title: "x", prompt: "x", frequency: "every hour" }, h.ctx({ agentId: "a9" }))).ok).toBe(true);
    const state = (await api(h, "state")) as { tasks: AgentTask[] };
    expect(state.tasks.map((t) => t.agent)).toEqual(["a9"]);
  });

  it("the plugins' jobs are not scheduled tasks: neither listed nor run from here", async () => {
    h = await harness([schedulerPlugin, user]);
    expect((await h.tool("TaskList").execute({}, h.ctx())).output).not.toContain("User refresh");
    await expect(api(h, "run-now", { id: "user:refresh" })).rejects.toThrow(/No scheduled task/);
    expect(await api(h, "state")).not.toHaveProperty("jobs");
  });

  it("the view: creates, updates, queues a run, hands over the finished reports", async () => {
    h = await harness([schedulerPlugin, user]);
    await expect(api(h, "create", { title: "x", prompt: "x", frequency: "every hour", agent: "Analyst" })).rejects.toThrow(/Choose the agent/);
    h.session.current = SESSION;
    const task = (await api(h, "create", { title: "Funding watch", prompt: "Check funding.", frequency: "every 4 hours", agent: "Analyst" })) as AgentTask;
    expect(task).toMatchObject({ agent: "a1", status: "active" });
    expect(await api(h, "update", { id: task.id, action: "pause" })).toMatchObject({ status: "paused" });
    await expect(api(h, "update", { id: task.id, action: "explode" })).rejects.toThrow(/Expected `id` and `action`/);
    /* The same id as `update`; the older forms still read. */
    expect(await api(h, "run-now", { id: task.id })).toEqual({ queued: task.id });
    expect(await api(h, "run-now", { id: `task:${task.id}` })).toEqual({ queued: task.id });
    await expect(api(h, "run-now", { id: "nothing" })).rejects.toThrow(/No scheduled task/);

    const store = pluginStore("scheduler", h.root);
    const run = (id: string, over: Partial<RunRecord>): RunRecord => ({ id, kind: "task", ref: task.id, title: "Funding watch", agentId: "a1", startedAt: "", finishedAt: `2026-09-23T10:0${id}:00.000Z`, ok: true, text: "Report", ...over });
    await store.append(RUNS, run("1", {}));
    await store.append(RUNS, run("2", { ok: false, error: "x" }));
    await store.append(RUNS, run("3", { kind: "job", ref: "user:refresh" }));
    await store.append(RUNS, run("4", {}));
    expect(((await api(h, "runs", {})) as RunRecord[]).map((r) => r.id)).toEqual(["1", "4"]);
    expect(((await api(h, "runs", { since: "2026-09-23T10:01:00.000Z" })) as RunRecord[]).map((r) => r.id)).toEqual(["4"]);
    const state = (await api(h, "state")) as { runs: Array<{ id: string; excerpt?: string; text?: string }> };
    /* A job's failure stays in the log, out of the view. */
    expect(state.runs.map((r) => r.id)).toEqual(["4", "2", "1"]);
    expect(state.runs[0]).toMatchObject({ excerpt: "Report" });
    expect(state.runs[0].text).toBeUndefined();
  });
});

describe("scheduler plugin — the tasks on the core's clock", () => {
  it("runs the agent, logs the report and announces it as a conversation", async () => {
    h = await harness([schedulerPlugin]);
    h.session.current = SESSION;
    const store = pluginStore("scheduler", h.root);
    await store.write("tasks.json", [task()]);
    await h.runtime.clock.tick(at(10));
    await h.runtime.clock.idle();
    expect(runAgentInBackground).toHaveBeenCalledWith(expect.objectContaining({ agentId: "Analyst", prompt: "Brief me.", purpose: 'scheduled task "Morning brief", every 1 hour' }), SESSION);
    const [run] = await store.lines<RunRecord>(RUNS);
    expect(run).toMatchObject({ kind: "task", ref: "t1", agentId: "a1", ok: true, prompt: "Brief me." });
    expect(h.notifications).toEqual([{ plugin: "scheduler", title: "Scheduled task: Morning brief", body: "Brief", level: "success", action: { kind: "open-conversation", conversationId: `run-${run.id}` } }]);
    expect((await store.read<Record<string, RunState>>(JOBS, {}))[taskKey("t1")]).toMatchObject({ lastStatus: "ok" });
  });

  it("a paused task waits, unless asked to run now; a failure says why", async () => {
    vi.mocked(runAgentInBackground).mockResolvedValueOnce({ ok: false, error: "No OpenRouter key: this agent cannot run." });
    h = await harness([schedulerPlugin]);
    h.session.current = SESSION;
    const store = pluginStore("scheduler", h.root);
    await store.write("tasks.json", [task({ status: "paused" })]);
    await h.runtime.clock.tick(at(10));
    await h.runtime.clock.idle();
    expect(runAgentInBackground).not.toHaveBeenCalled();
    await api(h, "run-now", { id: "t1" });
    await h.runtime.clock.tick(at(10, 1));
    await h.runtime.clock.idle();
    expect(runAgentInBackground).toHaveBeenCalledTimes(1);
    expect(h.notifications[0]).toMatchObject({ title: "Scheduled task failed: Morning brief", body: "No OpenRouter key: this agent cannot run.", level: "error", action: { kind: "open-view" } });
    /* One record: the clock adds none of its own for a task. */
    const runs = await store.lines<RunRecord>(RUNS);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: false, error: "No OpenRouter key: this agent cannot run." });
  });

  it("A6: a runner that THROWS is recorded, announced, and moved to its next time, not relaunched every 15 s", async () => {
    vi.mocked(runAgentInBackground).mockRejectedValue(new Error("ENOENT: no such file or directory, mkdir 'E:/trading'"));
    h = await harness([schedulerPlugin]);
    h.session.current = SESSION;
    const store = pluginStore("scheduler", h.root);
    await store.write("tasks.json", [task({ frequency: "daily at 08:00", agent: "a1" })]);
    await store.write(JOBS, { [taskKey("t1")]: { nextRun: new Date(at(8)).toISOString(), every: "daily at 08:00", lastRun: new Date(at(8, 0, 22)).toISOString() } });
    await h.runtime.clock.tick(at(7, 59));
    await h.runtime.clock.idle();
    for (let i = 0; i <= 4; i++) {
      await h.runtime.clock.tick(at(8) + 5_000 + i * 15_000);
      await h.runtime.clock.idle();
    }
    expect(runAgentInBackground).toHaveBeenCalledTimes(1);
    const runs = await store.lines<RunRecord>(RUNS);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: "task", ok: false, error: expect.stringMatching(/ENOENT/) });
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toMatchObject({ title: "Scheduled task failed: Morning brief", level: "error" });
    expect((await store.read<Record<string, RunState>>(JOBS, {}))[taskKey("t1")]).toMatchObject({ lastStatus: "failed", nextRun: new Date(at(8, 0, 24)).toISOString() });
  });

  it("moves a task's state kept under the old key (`task:<id>`) to the clock's (`scheduler:task:<id>`)", async () => {
    h = await harness([schedulerPlugin], { scheduler: { enabled: false, config: {}, agentIds: null } });
    const store = pluginStore("scheduler", h.root);
    await store.write(JOBS, { "task:t1": { lastRun: "2026-09-22T08:00:00.000Z", lastStatus: "ok" }, "alerts:check": { lastStatus: "ok" } });
    await h.runtime.apply({});
    expect(await store.read(JOBS, {})).toEqual({ "scheduler:task:t1": { lastRun: "2026-09-22T08:00:00.000Z", lastStatus: "ok" }, "alerts:check": { lastStatus: "ok" } });
  });
});
