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
   Workflow : lancer des sous-agents en parallele, et attendre leurs
   resultats. Version des agents a cle (OpenRouter).

   Chaque tache devient un agent a part entiere D'UN DES QUATRE METIERS :
   le prompt de sa profession, ses competences, le meme dossier de travail,
   les memes outils sauf Workflow (un sous-agent ne delegue pas a son tour)
   et ceux qui engagent des fonds — il tourne sur le serveur, sans
   permission a demander : c'est l'appel a Workflow lui-meme qui est soumis
   a l'accord de l'utilisateur. Le modele est celui que le parent a choisi
   pour la tache, sinon le sien. Trois a la fois au plus ; l'ecran voit
   chaque sous-agent demarrer et finir, puis son rapport.

   Les agents par abonnement ont le meme outil, servi en MCP par
   `lib/mcp/acp-workflow.ts` : meme schema, meme rapport.
--------------------------------------------------------------------------- */

type Args = { tasks: unknown; context?: string };

const SUBAGENT_TURNS = 25;

export const workflowTool: Tool<Args> = {
  name: "Workflow",
  description: workflowDescription({ kind: "openrouter" }),
  parameters: workflowParameters({ kind: "openrouter" }),
  async execute(args, ctx) {
    if (ctx.depth >= 1) return fail("Un sous-agent ne peut pas lancer de sous-agents.");
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
    const skills = await listSkills(ctx.workspace, ctx.projectRoot, prof.skills);
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
          if (!tool) return { ok: false, output: `Outil inconnu : ${call.name}` };
          return tool.execute(call.args, { ...sub, signal, emit, callId: call.id });
        },
        emit: () => {
          /* le detail d'un sous-agent ne remonte pas a l'ecran, seul son etat */
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
