import type { Tool, ToolContext } from "../types";
import { errorText, fail, ok } from "../types";
import { runAgentLoop, type ToolSpec } from "@/lib/agent/loop";
import { streamOpenRouter } from "@/lib/server/openrouter-stream";
import { allTools, toToolSpecs } from "../registry";

/* ---------------------------------------------------------------------------
   Workflow : lancer des sous-agents en parallele, et attendre leurs
   resultats.

   Chaque tache devient un agent a part entiere — meme modele, meme dossier
   de travail, memes outils sauf Workflow (un sous-agent ne delegue pas a son
   tour) — qui tourne sur le serveur, sans permission a demander : c'est
   l'appel a Workflow lui-meme qui est soumis a l'accord de l'utilisateur.
   Trois a la fois au plus ; l'ecran voit chaque sous-agent demarrer et
   finir.
--------------------------------------------------------------------------- */

type Task = { title: string; prompt: string; model?: string };
type Args = { tasks: Task[]; context?: string };

const CONCURRENCY = 3;
const MAX_TASKS = 8;
const SUBAGENT_TURNS = 25;

export const workflowTool: Tool<Args> = {
  name: "Workflow",
  description:
    "Confie des tâches indépendantes à des sous-agents qui travaillent en parallèle (3 à la fois, 8 au plus) avec les mêmes outils que vous, et rend leurs rapports. Donnez à chaque tâche un titre et un prompt complet et autonome : le sous-agent ne voit pas votre conversation. Utile pour explorer plusieurs pistes ou traiter plusieurs fichiers d'un coup.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Les tâches à confier.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court (3 à 6 mots)." },
            prompt: { type: "string", description: "La consigne complète : contexte, but, forme attendue du rapport." },
            model: { type: "string", description: "Un autre modèle OpenRouter pour cette tâche (facultatif)." },
          },
          required: ["title", "prompt"],
        },
      },
      context: { type: "string", description: "Contexte commun ajouté au début de chaque tâche (facultatif)." },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.depth >= 1) return fail("Un sous-agent ne peut pas lancer de sous-agents.");
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).filter((t) => t && typeof t.prompt === "string").slice(0, MAX_TASKS);
    if (tasks.length === 0) return fail("Donnez au moins une tâche avec un prompt.");

    const results: string[] = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await runOne(tasks[i], i, args.context, ctx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    return ok(results.join("\n\n"));
  },
};

async function runOne(task: Task, index: number, context: string | undefined, ctx: ToolContext): Promise<string> {
  const id = `${ctx.callId}:${index}`;
  const title = task.title || `Tâche ${index + 1}`;
  ctx.emit({ type: "subagent", id, index, title, status: "running" });
  const sub: ToolContext = { ...ctx, depth: ctx.depth + 1, callId: id };
  const tools = (await allTools({ platform: process.platform, bytnodeKey: ctx.bytnodeKey, exchangeAccounts: ctx.exchangeAccounts })).tools.filter((t) => t.name !== "Workflow");
  const specs: ToolSpec[] = toToolSpecs(tools);
  const model = task.model?.trim() || ctx.llm.model;
  try {
    const out = await runAgentLoop(
      [
        {
          role: "system",
          content:
            `Tu es un sous-agent chargé d'une tâche précise. Dossier de travail : ${ctx.workspace}. ` +
            "Travaille avec les outils, puis termine par un rapport clair et complet : c'est tout ce que ton commanditaire verra.",
        },
        { role: "user", content: (context ? `${context}\n\n` : "") + task.prompt },
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
    ctx.emit({ type: "subagent", id, index, title, status: "done" });
    return `## ${title}\n\n${out.text.trim() || "(rapport vide)"}`;
  } catch (e) {
    ctx.emit({ type: "subagent", id, index, title, status: "failed" });
    return `## ${title}\n\n[échec : ${errorText(e)}]`;
  }
}
