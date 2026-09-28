import { randomUUID } from "node:crypto";
import { JOBS, JobFailure, MAX_RUNS, RUNS, type JobSpec } from "../core/clock";
import { definePlugin, type Session } from "../core/contract";
import { schedulerManifest } from "./manifest";
import type { AgentRunInput, AgentRunResult, SchedulerService } from "./service";
import { taskCancelTool } from "./task-cancel";
import { taskListTool } from "./task-list";
import { taskScheduleTool } from "./task-schedule";
import { changeTask, findAgent, newTask, plannedRuns, runConversationId, taskJobId, taskKey, type AgentTask, type RunRecord, type RunState, type TaskAction } from "./tasks";

/* The "Scheduled tasks" plugin: the user's AGENT TASKS ("a market brief
   every morning at 8"), their three tools, the view's actions, and what
   the calendar may ask (`planned`). The tasks run on the core's clock
   (`ctx.jobs`, re-read at every tick: a subscription session's MCP server
   writes the same `tasks.json`). The clock itself is the core's: the
   other plugins' jobs (the alerts' check, the paper orders' watch…) run
   whether this plugin is on or off, and nothing here lists them. Its
   files sit next to the clock's (`jobs.json`, `runs.jsonl`), in the same
   folder, as before the clock moved to the core. */

const TASKS = "tasks.json";
const RECENT = 30;
const IMPORT_BATCH = 50;

/* Loaded when a run starts: it brings the ACP machinery, which the MCP
   server — tools only — never needs. */
const runAgent = async (input: AgentRunInput, session: Session) => (await import("./agent-runner")).runAgentInBackground(input, session);

const TASK_ACTIONS: TaskAction[] = ["pause", "resume", "delete"];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const schedulerPlugin = definePlugin({
  manifest: schedulerManifest,
  async setup(ctx) {
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

    /* Before the clock moved to the core, a task's state was kept under
       `task:<id>`; the clock now keys every job by its plugin. Renamed once. */
    if (Object.keys(await states()).some((k) => k.startsWith("task:"))) {
      await ctx.store.update<Record<string, RunState>>(JOBS, {}, (s) =>
        Object.fromEntries(Object.entries(s).map(([k, v]) => [k.startsWith("task:") && !(`scheduler:${k}` in s) ? `scheduler:${k}` : k, v])),
      );
    }

    /** One agent task as a job of the clock. Its run records itself (the
        view and the browser read `runs.jsonl`) and says so every time; a
        failure — a result that says why, or a runner that THROWS — is
        recorded and announced too, and the clock moves it to its next
        occurrence instead of launching it again at the next tick. */
    const taskJob = (task: AgentTask): JobSpec => ({
      id: taskJobId(task.id),
      title: task.title,
      every: task.frequency,
      catchUp: task.catchUp,
      paused: task.status !== "active",
      async run({ session, signal, cancelled }) {
        const started = new Date();
        let result: AgentRunResult;
        try {
          result = await runAgent({ agentId: task.agent, prompt: task.prompt, purpose: `scheduled task "${task.title}", ${task.frequency}`, signal }, session);
        } catch (e) {
          result = { ok: false, error: errorText(e) };
        }
        if (cancelled()) return;
        const agent = findAgent(session.agents, task.agent);
        const record: RunRecord = {
          id: randomUUID().slice(0, 12),
          kind: "task",
          ref: task.id,
          title: task.title,
          ...(agent ? { agentId: agent.id } : {}),
          prompt: task.prompt,
          startedAt: started.toISOString(),
          finishedAt: new Date().toISOString(),
          ok: result.ok,
          ...(result.ok ? { text: result.text } : { error: result.error }),
        };
        await ctx.store.append(RUNS, record, MAX_RUNS);
        await ctx.notify({
          title: result.ok ? `Scheduled task: ${task.title}` : `Scheduled task failed: ${task.title}`,
          body: result.ok ? firstLine(result.text) : result.error,
          level: result.ok ? "success" : "error",
          /* A report becomes a conversation; a failure is read in the view. */
          action: result.ok && agent ? { kind: "open-conversation", conversationId: runConversationId(record.id) } : { kind: "open-view", view: "scheduler" },
        });
        if (!result.ok) throw new JobFailure(result.error);
        return "done";
      },
    });
    ctx.jobs(async () => (await tasks()).map(taskJob));

    ctx.tool(taskScheduleTool(add, () => ctx.session()));
    ctx.tool(taskListTool(async () => ({ tasks: await tasks(), states: await states() })));
    ctx.tool(taskCancelTool(change));

    ctx.provide<SchedulerService>(() => ({
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
        tasks: list.map((t) => ({ ...t, state: s[taskKey(t.id)] ?? {}, running: ctx.jobRunning(taskJobId(t.id)) })),
        runs: runs
          .filter((r) => r.kind === "task")
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
    /* The same id as `update` (the bare task id); the older `task:<id>`
       and `scheduler:task:<id>` forms are read too. */
    ctx.api("run-now", async (params) => {
      const raw = typeof params.id === "string" ? params.id : "";
      const ref = raw.replace(/^scheduler:/, "").replace(/^task:/, "");
      const task = (await tasks()).find((t) => t.id === ref);
      if (!task) throw new Error(`No scheduled task under "${raw}".`);
      await ctx.trigger(taskJobId(task.id));
      return { queued: task.id };
    });
    /* The finished task runs the browser turns into conversations. */
    ctx.api("runs", async (params) => {
      const since = typeof params.since === "string" ? params.since : "";
      const runs = await ctx.store.lines<RunRecord>(RUNS);
      return runs.filter((r) => r.kind === "task" && r.ok && r.agentId && r.finishedAt > since).slice(-IMPORT_BATCH);
    });
  },
});

const firstLine = (text: string) => {
  const line = text.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
};
