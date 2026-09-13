import type { PlanEntry } from "@/lib/agent/events";
import type { Tool } from "./types";
import { fail, ok } from "./types";

/* ---------------------------------------------------------------------------
   TodoWrite : la liste de taches que l'agent se donne.

   Sur une tache longue (collecter → tester → tracer → rediger), le modele
   perd le fil et l'utilisateur ne voit pas ou il en est. La liste, renvoyee
   EN ENTIER a chaque appel, est publiee comme un `plan` — le meme evenement
   que les agents par abonnement, rendu par le meme bloc dans le fil, jamais
   rejoue au modele (`history.ts`). Le modele, lui, la recoit en texte.

   Pur : ni disque ni reseau. L'etat, c'est le dernier appel.
--------------------------------------------------------------------------- */

const STATUSES: PlanEntry["status"][] = ["pending", "in_progress", "completed"];
const MARK: Record<PlanEntry["status"], string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };

type Args = { todos: Array<{ content: string; status: string }> };

export const todoTool: Tool<Args> = {
  name: "TodoWrite",
  description:
    "Ta liste de tâches pour le travail en cours, affichée à l'utilisateur. Envoie la liste COMPLÈTE à chaque appel (elle remplace la précédente). " +
    "Utilise-la dès qu'une demande compte plus de deux étapes : écris les étapes avant de commencer, passe UNE tâche en `in_progress` quand tu l'attaques, en `completed` sitôt finie. " +
    "Une liste vide efface le plan.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "Les tâches, dans l'ordre.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "La tâche, courte, à l'impératif." },
            status: { type: "string", enum: STATUSES },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const entries: PlanEntry[] = [];
    for (const [i, t] of (args.todos ?? []).entries()) {
      if (typeof t !== "object" || t === null) return fail(`\`todos[${i}]\` : objet { content, status } attendu.`);
      if (typeof t.content !== "string" || !t.content.trim()) return fail(`\`todos[${i}].content\` : texte non vide attendu.`);
      if (!STATUSES.includes(t.status as PlanEntry["status"])) return fail(`\`todos[${i}].status\` : ${STATUSES.join(", ")} attendu, reçu ${JSON.stringify(t.status)}.`);
      entries.push({ content: t.content.trim(), status: t.status as PlanEntry["status"] });
    }
    if (entries.filter((e) => e.status === "in_progress").length > 1) {
      return fail("Une seule tâche `in_progress` à la fois : termine (ou remets en `pending`) les autres.");
    }
    ctx.emit({ type: "plan", entries });
    if (entries.length === 0) return ok("Liste vidée.");
    const done = entries.filter((e) => e.status === "completed").length;
    const head = `Liste à jour (${done}/${entries.length} faite${done > 1 ? "s" : ""}) :`;
    return ok([head, ...entries.map((e) => `${MARK[e.status]} ${e.content}`)].join("\n"));
  },
};
