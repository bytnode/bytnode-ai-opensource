import { allowedForSubagent } from "../names";
import type { Tool, ToolContext } from "../types";
import { errorText, fail, ok } from "../types";
import { runAgentLoop, type ToolSpec } from "@/lib/agent/loop";
import { buildToolsPrompt } from "@/lib/agent/tools-prompt";
import { streamOpenRouter } from "@/lib/server/openrouter-stream";
import { loadProfession } from "@/lib/professions/load";
import { listSkills } from "../skills/skill";
import { allTools, toToolSpecs } from "../registry";
import { failureBody, readTasks, reportSection, runInPool, subagentFrame, subagentMessage, workflowDescription, workflowParameters, type SubagentTask } from "./subagent";

/* ---------------------------------------------------------------------------
   Workflow: launch sub-agents in parallel, and wait for their results.
   Key agents' version (OpenRouter).

   Each task becomes a fully-fledged agent OF ONE OF THE FOUR PROFESSIONS:
   its profession's prompt, its skills, the same workspace, the same tools
   except Workflow (a sub-agent does not delegate in turn) and those that
   commit funds — it runs on the server, with no permission to ask: it is
   the call to Workflow itself that is subject to the user's approval. The
   model is the one the parent chose for the task, otherwise its own. Three
   at a time at most; the screen sees each sub-agent start and finish, then
   its report.

   Subscription agents have the same tool, served over MCP by
   `lib/mcp/acp-workflow.ts`: same schema, same report.
--------------------------------------------------------------------------- */

type Args = { tasks: unknown; context?: string };

const SUBAGENT_TURNS = 25;

export const workflowTool: Tool<Args> = {
  name: "Workflow",
  description: workflowDescription({ kind: "openrouter" }),
  parameters: workflowParameters({ kind: "openrouter" }),
  async execute(args, ctx) {
    if (ctx.depth >= 1) return fail("A sub-agent cannot launch sub-agents.");
    const read = readTasks(args.tasks);
    if ("error" in read) return fail(read.error);
    const { tasks } = read;

    const results = await runInPool(tasks, (task, i) => runOne(task, i, args.context, ctx));
    return ok(results.join("\n\n"));
  },
};

async function runOne(task: SubagentTask, index: number, context: string | undefined, ctx: ToolContext): Promise<string> {
  const id = `${ctx.callId}:${index}`;
  const { title, profession } = task;
  ctx.emit({ type: "subagent", id, index, title, profession, status: "running" });
  try {
    const [prof, { tools: every, bytnode }] = await Promise.all([
      loadProfession(ctx.projectRoot, profession),
      allTools({ platform: process.platform, bytnodeKey: ctx.bytnodeKey, exchangeAccounts: ctx.exchangeAccounts }),
    ]);
    const skills = await listSkills(ctx.workspace, prof.skills);
    const tools = every.filter((t) => allowedForSubagent(t.name));
    const specs: ToolSpec[] = toToolSpecs(tools);
    const sub: ToolContext = { ...ctx, depth: ctx.depth + 1, callId: id, professionSkills: prof.skills };
    const model = task.model || ctx.llm.model;
    const system = [
      subagentFrame(profession, prof.prompt, ctx.workspace),
      buildToolsPrompt(ctx.workspace, skills, `${process.platform} (${process.arch})`, ctx.scope, bytnode, ctx.exchangeAccounts, 0, true),
    ].join("\n\n");
    const out = await runAgentLoop(
      [
        { role: "system", content: system },
        { role: "user", content: subagentMessage(task, context) },
      ],
      {
        complete: (messages, t, signal) => streamOpenRouter({ apiKey: ctx.llm.apiKey, model, effort: ctx.llm.effort, messages, tools: t, signal }),
        execute: async (call, signal, emit) => {
          const tool = tools.find((t) => t.name === call.name);
          if (!tool) return { ok: false, output: `Unknown tool: ${call.name}` };
          return tool.execute(call.args, { ...sub, signal, emit, callId: call.id });
        },
        emit: () => {
          /* a sub-agent's detail does not reach the screen, only its state */
        },
        tools: specs,
        maxTurns: SUBAGENT_TURNS,
        signal: ctx.signal,
      },
    );
    const report = out.text.trim();
    ctx.emit({ type: "subagent", id, index, title, profession, status: "done", report });
    return reportSection(task, report);
  } catch (e) {
    const why = errorText(e);
    ctx.emit({ type: "subagent", id, index, title, profession, status: "failed", report: failureBody(why) });
    return reportSection(task, failureBody(why));
  }
}
