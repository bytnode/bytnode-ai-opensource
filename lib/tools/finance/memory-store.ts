/* ---------------------------------------------------------------------------
   La memoire d'un agent : des notes qui survivent aux conversations.

   Un fichier JSONL dans le dossier de travail (`.bytnode-ai/memory.jsonl`),
   une entree par ligne : ce que l'agent a decide de retenir — une these,
   un niveau surveille, une strategie deja testee et son verdict. Les
   dernieres entrees sont glissees dans le prompt de chaque conversation.
   Pur : le disque est dans memory.ts.
--------------------------------------------------------------------------- */

export type MemoryEntry = { id: string; at: number; text: string; tags: string[] };

export const MEMORY_FILE = ".bytnode-ai/memory.jsonl";
export const PROMPT_ENTRIES = 25;
const MAX_ENTRIES = 500;

export function parseMemory(text: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Partial<MemoryEntry>;
      if (typeof v.id === "string" && typeof v.text === "string") {
        out.push({ id: v.id, at: typeof v.at === "number" ? v.at : 0, text: v.text, tags: Array.isArray(v.tags) ? v.tags.map(String) : [] });
      }
    } catch {
      /* ligne illisible : ignoree */
    }
  }
  return out;
}

export const serializeMemory = (entries: MemoryEntry[]) => entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");

export function addEntry(entries: MemoryEntry[], text: string, tags: string[], newId: () => string, now: () => number): MemoryEntry[] {
  const t = text.trim();
  if (!t) return entries;
  if (entries.some((e) => e.text === t)) return entries;
  const next = [...entries, { id: newId(), at: now(), text: t, tags: tags.map((x) => x.trim().toLowerCase()).filter(Boolean) }];
  return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
}

export const removeEntry = (entries: MemoryEntry[], id: string) => entries.filter((e) => e.id !== id);

export function searchEntries(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const words = q.split(/\s+/);
  return entries.filter((e) => {
    const hay = `${e.text} ${e.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const stamp = (at: number) => (at ? new Date(at).toISOString().slice(0, 10) : "?");

export const formatEntry = (e: MemoryEntry) => `- [${e.id}] ${stamp(e.at)}${e.tags.length ? ` (${e.tags.join(", ")})` : ""} : ${e.text}`;

/** Le bloc « Mémoire » du prompt : les dernieres entrees, et le compte de
    ce qui reste consultable par l'outil. */
export function renderMemoryPrompt(entries: MemoryEntry[], limit = PROMPT_ENTRIES): string {
  if (entries.length === 0) return "";
  const shown = entries.slice(-limit);
  const older = entries.length - shown.length;
  const lines = [
    "## Mémoire de l'agent",
    "",
    "Ce que tu as retenu des conversations précédentes (outil Memory pour ajouter, chercher, retirer). Appuie-toi dessus, et note ce qui mérite de survivre à cette conversation : une thèse, un niveau, un résultat de test, une préférence de l'utilisateur.",
    "",
    ...shown.map(formatEntry),
  ];
  if (older > 0) lines.push("", `(${older} plus ancienne${older > 1 ? "s" : ""} : Memory search / list)`);
  return lines.join("\n");
}
