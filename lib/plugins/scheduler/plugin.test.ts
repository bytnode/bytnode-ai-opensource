import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import { definePlugin, type Session } from "../core/contract";
import { pluginStore } from "../core/store";
import { manifest } from "../core/test-fixture";
import { harness, type Harness } from "../test-fixture";
import { RUNS } from "./engine";
import type { SchedulerService } from "./service";
import type { AgentTask, RunRecord } from "./tasks";
import { schedulerPlugin } from ".";

const SESSION = { agents: [{ id: "a1", name: "Analyst" }] as AgentConfig[] } as Session;

/* A plugin that uses the scheduler, as the portfolio or the alerts do. */
const user = definePlugin({
  manifest: manifest("user", [], ["scheduler"]),
  setup(ctx) {
    ctx.optional<SchedulerService>("scheduler")?.job({ id: "refresh", title: "User refresh", every: "every 10 minutes", run: async () => "ok" });
  },
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

  it("the jobs of a plugin appear with it and go with it", async () => {
    h = await harness([schedulerPlugin, user]);
    expect((await h.tool("TaskList").execute({}, h.ctx())).output).toContain("- User refresh — every 10 minutes; never run; next —");
    await h.runtime.apply({ user: { enabled: false, config: {}, agentIds: null } });
    expect((await h.tool("TaskList").execute({}, h.ctx())).output).not.toContain("User refresh");
  });

  it("the view: creates, updates, queues a run, hands over the finished reports", async () => {
    h = await harness([schedulerPlugin, user]);
    await expect(api(h, "create", { title: "x", prompt: "x", frequency: "every hour", agent: "Analyst" })).rejects.toThrow(/Choose the agent/);
    h.session.current = SESSION;
    const task = (await api(h, "create", { title: "Funding watch", prompt: "Check funding.", frequency: "every 4 hours", agent: "Analyst" })) as AgentTask;
    expect(task).toMatchObject({ agent: "a1", status: "active" });
    expect(await api(h, "update", { id: task.id, action: "pause" })).toMatchObject({ status: "paused" });
    await expect(api(h, "update", { id: task.id, action: "explode" })).rejects.toThrow(/Expected `id` and `action`/);
    expect(await api(h, "run-now", { id: `task:${task.id}` })).toEqual({ queued: `task:${task.id}` });
    expect(await api(h, "run-now", { id: "user:refresh" })).toEqual({ queued: "user:refresh" });
    await expect(api(h, "run-now", { id: "nothing" })).rejects.toThrow(/Nothing scheduled/);

    const store = pluginStore("scheduler", h.root);
    const run = (id: string, over: Partial<RunRecord>): RunRecord => ({ id, kind: "task", ref: task.id, title: "Funding watch", agentId: "a1", startedAt: "", finishedAt: `2026-09-23T10:0${id}:00.000Z`, ok: true, text: "Report", ...over });
    await store.append(RUNS, run("1", {}));
    await store.append(RUNS, run("2", { ok: false, error: "x" }));
    await store.append(RUNS, run("3", { kind: "job", ref: "user:refresh" }));
    await store.append(RUNS, run("4", {}));
    expect(((await api(h, "runs", {})) as RunRecord[]).map((r) => r.id)).toEqual(["1", "4"]);
    expect(((await api(h, "runs", { since: "2026-09-23T10:01:00.000Z" })) as RunRecord[]).map((r) => r.id)).toEqual(["4"]);
    const state = (await api(h, "state")) as { jobs: Array<{ id: string }>; runs: Array<{ id: string; excerpt?: string; text?: string }> };
    expect(state.jobs.map((j) => j.id)).toEqual(["user:refresh"]);
    expect(state.runs.map((r) => r.id)).toEqual(["4", "3", "2", "1"]);
    expect(state.runs[0]).toMatchObject({ excerpt: "Report" });
    expect(state.runs[0].text).toBeUndefined();
  });
});
