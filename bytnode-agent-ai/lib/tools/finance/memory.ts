import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { MEMORY_FILE, addEntry, formatEntry, parseMemory, removeEntry, renderMemoryPrompt, searchEntries, serializeMemory, type MemoryEntry } from "./memory-store";

/* Memory : la memoire persistante de l'agent, dans son dossier de travail.
   Le fichier est partage avec les agents par abonnement (meme dossier). */

type Args = { action: "add" | "list" | "search" | "remove"; text?: string; tags?: string[]; query?: string; id?: string };

export async function readMemory(workspace: string): Promise<MemoryEntry[]> {
  try {
    return parseMemory(await fs.readFile(path.join(workspace, MEMORY_FILE), "utf8"));
  } catch {
    return [];
  }
}

async function writeMemory(workspace: string, entries: MemoryEntry[]) {
  const file = path.join(workspace, MEMORY_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serializeMemory(entries));
}

/** Le bloc de prompt, pret a etre joint au prompt systeme. */
export async function memoryPrompt(workspace: string): Promise<string> {
  return renderMemoryPrompt(await readMemory(workspace));
}

const shortId = () => randomUUID().slice(0, 8);

export const memoryTool: Tool<Args> = {
  name: "Memory",
  description:
    "Ta mémoire entre les conversations, propre à cet agent. `add` : retenir une note courte et datée (une thèse de marché, un niveau surveillé, une stratégie testée et son verdict, une préférence de l'utilisateur) avec des tags ; " +
    "`list` : tout relire ; `search` : chercher par mots ; `remove` : retirer une note par son id. Les dernières notes sont déjà dans ton prompt (section Mémoire). " +
    "Note ce qui vaut la peine de survivre à la conversation, pas ce qui se relit dans les données.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "list", "search", "remove"] },
      text: { type: "string", description: "add : la note (une à trois phrases)." },
      tags: { type: "array", items: { type: "string" }, description: "add : des mots-clés (btc, macro, strategie…)." },
      query: { type: "string", description: "search : les mots à chercher." },
      id: { type: "string", description: "remove : l'id de la note." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const entries = await readMemory(ctx.workspace);
    switch (args.action) {
      case "add": {
        if (!args.text?.trim()) return fail("`text` est requis pour add.");
        const next = addEntry(entries, args.text, args.tags ?? [], shortId, Date.now);
        if (next.length === entries.length) return ok("Déjà en mémoire, rien d'ajouté.");
        await writeMemory(ctx.workspace, next);
        return ok(`Retenu ${formatEntry(next[next.length - 1])}\n(${next.length} note${next.length > 1 ? "s" : ""} en mémoire)`);
      }
      case "list":
        return ok(entries.length ? entries.map(formatEntry).join("\n") : "Mémoire vide.");
      case "search": {
        const found = searchEntries(entries, args.query ?? "");
        return ok(found.length ? found.map(formatEntry).join("\n") : `Rien pour « ${args.query ?? ""} ».`);
      }
      case "remove": {
        if (!args.id) return fail("`id` est requis pour remove.");
        const next = removeEntry(entries, args.id);
        if (next.length === entries.length) return fail(`Aucune note avec l'id ${args.id}.`);
        await writeMemory(ctx.workspace, next);
        return ok(`Retirée. ${next.length} note${next.length > 1 ? "s" : ""} restante${next.length > 1 ? "s" : ""}.`);
      }
      default:
        return fail(`Action inconnue : ${String(args.action)}`);
    }
  },
};
