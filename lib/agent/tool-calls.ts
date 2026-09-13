import type { ToolCallFragment } from "@/lib/llm/sse";

/* ---------------------------------------------------------------------------
   Recoudre les appels d'outils.

   Le flux les envoie en morceaux, par index : un fragment porte l'id et le
   nom, les suivants ajoutent les arguments caractere par caractere. On les
   recolle par index, et on n'interprete le JSON qu'a la fin.
--------------------------------------------------------------------------- */

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArgs: string;
  /** Les arguments recus n'etaient pas du JSON lisible : `args` est vide
      par defaut, et le modele doit l'apprendre tel quel. */
  argsError?: string;
};

export class ToolCallAccumulator {
  private parts = new Map<number, { id?: string; name?: string; args: string }>();

  add(fragments: ToolCallFragment[]) {
    for (const f of fragments) {
      const cur = this.parts.get(f.index) ?? { args: "" };
      if (f.id) cur.id = f.id;
      if (f.name) cur.name = f.name;
      if (f.args) cur.args += f.args;
      this.parts.set(f.index, cur);
    }
  }

  get size() {
    return this.parts.size;
  }

  /** Oublier ce qui a ete recolle : un tour relance apres une erreur
      transitoire repart de zero, sinon les fragments se melangeraient. */
  reset() {
    this.parts.clear();
  }

  calls(): ToolCall[] {
    return [...this.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, p]) => {
        const parsed = parseArgs(p.args);
        return {
          id: p.id ?? `call_${i}_${Math.random().toString(36).slice(2, 8)}`,
          name: p.name ?? "",
          args: parsed.args,
          rawArgs: p.args,
          ...(parsed.error ? { argsError: parsed.error } : {}),
        };
      });
  }
}

function parseArgs(raw: string): { args: Record<string, unknown>; error?: string } {
  if (!raw.trim()) return { args: {} };
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return { args: v as Record<string, unknown> };
    return { args: {}, error: "les arguments doivent être un objet JSON" };
  } catch (e) {
    return { args: {}, error: `JSON illisible (${e instanceof Error ? e.message : String(e)})` };
  }
}
