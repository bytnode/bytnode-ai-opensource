import { randomUUID } from "node:crypto";
import { definePlugin, type Session } from "../core/contract";
import { Clock, JOBS, RUNS, TASKS } from "./engine";
import { schedulerManifest } from "./manifest";
import type { AgentRunInput, SchedulerService } from "./service";
import { taskCancelTool } from "./task-cancel";
import { taskListTool } from "./task-list";
import { taskScheduleTool } from "./task-schedule";
import { changeTask, findAgent, newTask, plannedRuns, taskKey, type AgentTask, type RunRecord, type RunState, type TaskAction } from "./tasks";

/* The scheduler: the clock of the background (`engine.ts`), the user's
   agent tasks and their three tools, the service the other plugins
   register their jobs with, and the view's actions. The clock ticks in the
   Next server only (`ctx.background`); the MCP server of a subscription
   session serves the same tools over the same files. */

const RECENT = 30;
const IMPORT_BATCH = 50;

/* Loaded when a run starts: it brings the ACP machinery, which the MCP
   server — tools only — never needs. */
const runAgent = async (input: AgentRunInput, session: Session) => (await import("./agent-runner")).runAgentInBackground(input, session);

const TASK_ACTIONS: TaskAction[] = ["pause", "resume", "delete"];

export const schedulerPlugin = definePlugin({
  manifest: schedulerManifest,
  setup(ctx) {
    const clock = new Clock({ store: ctx.store, session: () => ctx.session(), notify: (n) => ctx.notify(n), runAgent, log: (m) => ctx.log(m) });
    if (ctx.background) clock.start();
    ctx.onDispose(() => clock.stop());

    const tasks = () => ctx.store.read<AgentTask[]>(TASKS, []);
    const states = () => ctx.store.read<Record<string, RunState>>(JOBS, {});
    const add = async (task: AgentTask) => void (await ctx.store.update<AgentTask[]>(TASKS, [], (list) => [...list, task]));
    const change = async (ref: string, action: TaskAction) => {
      let result = { error: "" } as ReturnType<typeof changeTask>;
      await ctx.store.update<AgentTask[]>(TASKS, [], (list) => {
        result = changeTask(list, ref, action);
        return "error" in result ? list : result.tasks;
      });
      if (!("error" in result) && action === "delete") {
        const key = taskKey(result.task.id);
        await ctx.store.update<Record<string, RunState>>(JOBS, {}, (s) => Object.fromEntries(Object.entries(s).filter(([id]) => id !== key)));
      }
      return result;
    };

    ctx.tool(taskScheduleTool(add, () => ctx.session()));
    ctx.tool(taskListTool(async () => ({ tasks: await tasks(), jobs: clock.list(), states: await states() })));
    ctx.tool(taskCancelTool(change));

    /* What a dependent plugin registers belongs to it: its jobs go when it
       stops. */
    ctx.provide<SchedulerService>((caller) => ({
      job: (spec) => caller.onDispose(clock.register(`${caller.id}:${spec.id}`, caller.id, spec)),
      trigger: (jobId) => clock.trigger(`${caller.id}:${jobId}`),
      runAgent: async (input) => {
        const session = ctx.session();
        if (!session) return { ok: false, error: "No tab is open: background runs need the app open." };
        return runAgent(input, session);
      },
      planned: async (from, to) => {
        const agents = ctx.session()?.agents ?? [];
        return plannedRuns(await tasks(), await states(), from.getTime(), to.getTime(), Date.now(), (ref) => findAgent(agents, ref)?.name ?? ref);
      },
    }));

    /* --- The view ---------------------------------------------------------- */

    ctx.api("state", async () => {
      const [list, s, runs] = await Promise.all([tasks(), states(), ctx.store.lines<RunRecord>(RUNS)]);
      return {
        /* The view's "now": every relative time on it is read against it. */
        at: new Date().toISOString(),
        tasks: list.map((t) => ({ ...t, state: s[taskKey(t.id)] ?? {}, running: clock.isRunning(taskKey(t.id)) })),
        jobs: clock.list().map((j) => ({ ...j, state: s[j.id] ?? {} })),
        runs: runs
          .slice(-RECENT)
          .reverse()
          .map(({ text, ...r }) => ({ ...r, excerpt: text ? text.slice(0, 280) : undefined })),
      };
    });
    ctx.api("create", async (params) => {
      const agents = ctx.session()?.agents ?? [];
      const agent = typeof params.agent === "string" ? findAgent(agents, params.agent) : undefined;
      if (!agent) throw new Error("Choose the agent that runs the task.");
      const task = newTask({ ...params, agent: agent.id }, randomUUID().slice(0, 8), new Date());
      if ("error" in task) throw new Error(task.error);
      await add(task);
      return task;
    });
    ctx.api("update", async (params) => {
      const action = TASK_ACTIONS.find((a) => a === params.action);
      if (!action || typeof params.id !== "string") throw new Error("Expected `id` and `action` (pause, resume, delete).");
      const r = await change(params.id, action);
      if ("error" in r) throw new Error(r.error);
      return r.task;
    });
    ctx.api("run-now", async (params) => {
      const id = typeof params.id === "string" ? params.id : "";
      const known = (await tasks()).some((t) => taskKey(t.id) === id) || clock.list().some((j) => j.id === id);
      if (!known) throw new Error(`Nothing scheduled under "${id}".`);
      await clock.trigger(id);
      return { queued: id };
    });
    /* The finished task runs the browser turns into conversations. */
    ctx.api("runs", async (params) => {
      const since = typeof params.since === "string" ? params.since : "";
      const runs = await ctx.store.lines<RunRecord>(RUNS);
      return runs.filter((r) => r.kind === "task" && r.ok && r.agentId && r.finishedAt > since).slice(-IMPORT_BATCH);
    });
  },
});
