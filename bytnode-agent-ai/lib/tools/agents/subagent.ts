import type { JsonSchema } from "../types";
import { PROFESSIONS, isProfessionId, professionInfo, type ProfessionId } from "@/lib/professions/catalog";

/* ---------------------------------------------------------------------------
   Les sous-agents : ce que les deux moteurs partagent.

   Un sous-agent est TOUJOURS un des quatre metiers de BytNode-AI — le
   parent choisit la profession selon la nature de la tache, et le modele
   selon sa difficulte. Ce module porte ce que l'outil `Workflow` declare au
   modele (schema, description), le cadre du prompt d'un sous-agent, et la
   forme du rapport rendu au parent — la meme pour un agent a cle (la boucle
   tourne sur le serveur) et pour un agent par abonnement (une session ACP
   jetable). Pur, teste.
--------------------------------------------------------------------------- */

export type SubagentTask = { title: string; prompt: string; profession: ProfessionId; model?: string };

export const CONCURRENCY = 3;
export const MAX_TASKS = 8;

/** Les modeles que le parent peut donner a une tache : n'importe quel id
    OpenRouter (agents a cle), ou la liste de son agent (agents par
    abonnement — vide quand elle n'a pas pu etre lue). */
export type ModelChoice = { kind: "openrouter" } | { kind: "list"; ids: string[] };

const PROFESSION_LINE = PROFESSIONS.map((p) => `${p.id} (${p.short.toLowerCase()} — ${p.description.replace(/\.$/, "")})`).join(" ; ");

export function workflowDescription(models: ModelChoice): string {
  const modelRule =
    models.kind === "openrouter"
      ? "`model` : un id de modèle OpenRouter — sans `model`, le tien."
      : models.ids.length
        ? `\`model\` parmi : ${models.ids.join(", ")} — sans \`model\`, ton modèle courant.`
        : "`model` : un des modèles de ton agent — sans `model`, ton modèle courant.";
  return (
    `Confie des tâches indépendantes à des sous-agents qui travaillent en parallèle (${CONCURRENCY} à la fois, ${MAX_TASKS} au plus) et rend leurs rapports. ` +
    `Chaque sous-agent EST un des quatre métiers de BytNode-AI, \`profession\` obligatoire : ${PROFESSION_LINE}. Choisis le métier selon la nature de la tâche. ` +
    `Choisis le modèle selon la difficulté : un modèle plus léger et rapide pour une tâche simple (collecte, mise en forme), un modèle fort pour une tâche exigeante. ${modelRule} ` +
    "Donne à chaque tâche un titre et un prompt complet et autonome : le sous-agent ne voit pas ta conversation. Il a tes outils, sauf Workflow et tout ce qui engage des fonds (il rapporte, il n'agit pas sur un compte)."
  );
}

export function workflowParameters(models: ModelChoice): JsonSchema {
  const model: Record<string, unknown> = { type: "string", description: "Le modèle de cette tâche, selon sa difficulté (facultatif)." };
  if (models.kind === "list" && models.ids.length) model.enum = models.ids;
  return {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Les tâches à confier.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court (3 à 6 mots)." },
            profession: { type: "string", enum: PROFESSIONS.map((p) => p.id), description: "Le métier du sous-agent." },
            prompt: { type: "string", description: "La consigne complète : contexte, but, forme attendue du rapport." },
            model,
          },
          required: ["title", "profession", "prompt"],
        },
      },
      context: { type: "string", description: "Contexte commun ajouté au début de chaque tâche (facultatif)." },
    },
    required: ["tasks"],
    additionalProperties: false,
  };
}

/** Les taches, CONCURRENCY a la fois, chaque resultat a l'index de sa tache. */
export async function runInPool<T>(tasks: readonly SubagentTask[], run: (task: SubagentTask, index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await run(tasks[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return results;
}

/** Les taches d'un appel, dans l'ordre et A LEUR INDEX (le fil les nomme
    par lui), bornees a MAX_TASKS — ou la phrase a rendre au modele si l'une
    d'elles est incomplete. Le schema a normalement deja tout refuse ; ici
    on tient aussi le prompt vide. */
export function readTasks(raw: unknown): { tasks: SubagentTask[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Donnez au moins une tâche, avec un titre, une profession (standard, analyste, strategique, quantitatif) et un prompt." };
  const tasks: SubagentTask[] = [];
  for (const [i, t] of raw.slice(0, MAX_TASKS).entries()) {
    const { title, prompt, profession, model } = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (!isProfessionId(profession)) return { error: `La tâche ${i + 1} n'a pas de profession valide (standard, analyste, strategique, quantitatif).` };
    if (typeof prompt !== "string" || !prompt.trim()) return { error: `La tâche ${i + 1} n'a pas de prompt.` };
    tasks.push({
      title: typeof title === "string" && title.trim() ? title.trim() : `Tâche ${i + 1}`,
      prompt,
      profession,
      ...(typeof model === "string" && model.trim() ? { model: model.trim() } : {}),
    });
  }
  return { tasks };
}

/** Le cadre du prompt systeme d'un sous-agent : son metier, puis ce qui le
    distingue d'un agent complet — une tache, un rapport, pas de delegation,
    pas de fonds engages. L'environnement (dossier, outils, competences)
    vient ensuite, fourni par le moteur. */
export function subagentFrame(profession: ProfessionId, professionPrompt: string, workspace: string): string {
  const info = professionInfo(profession);
  return [
    `Tu es un sous-agent ${info.label} de BytNode-AI, chargé d'une tâche précise par un agent commanditaire. Dossier de travail : \`${workspace}\`.`,
    professionPrompt.trim(),
    [
      "## Ta mission",
      "",
      "- Tu n'as que la tâche ci-dessous : pas la conversation de ton commanditaire, ni l'utilisateur pour te répondre. Si une information manque, dis-le dans ton rapport et fais au mieux.",
      "- Tu ne délègues pas (pas de sous-agents) et tu n'engages jamais de fonds : pas d'ordre, de fermeture ni de transfert — tu rapportes ce que tu recommandes.",
      "- Termine par un rapport clair et complet, dans la forme de ton métier : c'est tout ce que ton commanditaire verra. Chiffres, sources (outils appelés, fichiers écrits), limites.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Le message envoye au sous-agent : le contexte commun, puis sa tache. */
export const subagentMessage = (task: SubagentTask, context?: string) => (context?.trim() ? `${context.trim()}\n\n${task.prompt}` : task.prompt);

/* --- Le rapport rendu au parent -------------------------------------------
   Une section par tache, en-tete `## <titre> — <Profession>`. Le fil la
   redecoupe (`parseWorkflowReport`) pour montrer chaque sous-agent avec son
   rapport, meme quand rien n'a ete emis en route (appel MCP). */

const HEAD = /^## (.+?) — (Standard|Analyste|Stratégique|Quantitatif)$/;

export const reportSection = (task: SubagentTask, body: string) => `## ${task.title.replace(/\n/g, " ")} — ${professionInfo(task.profession).label}\n\n${body.trim() || "(rapport vide)"}`;

export const failureBody = (why: string) => `[échec : ${why}]`;

export type ReportSection = { title: string; profession: ProfessionId; body: string; failed: boolean };

export function parseWorkflowReport(output: string): ReportSection[] {
  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (!current) return;
    const body = lines.join("\n").trim();
    sections.push({ ...current, body, failed: /^\[échec : /.test(body) });
    lines.length = 0;
  };
  for (const line of output.split("\n")) {
    const m = HEAD.exec(line);
    if (m) {
      flush();
      const profession = PROFESSIONS.find((p) => p.label === m[2])?.id ?? "standard";
      current = { title: m[1], profession, body: "", failed: false };
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return sections;
}
