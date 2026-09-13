import type { ToolCallFragment } from "@/lib/llm/sse";

/* ---------------------------------------------------------------------------
   Recoudre les appels d'outils.

   Le flux les envoie en morceaux, par index : un fragment porte l'id et le
   nom, les suivants ajoutent les arguments caractere par caractere. On les
   recolle par index, et on n'interprete le JSON qu'a la fin.
--------------------------------------------------------------------------- */

export type ToolCall = { id: string; name: string; args: Record<string, unknown>; rawArgs: string };

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
      .map(([i, p]) => ({
        id: p.id ?? `call_${i}_${Math.random().toString(36).slice(2, 8)}`,
        name: p.name ?? "",
        args: parseArgs(p.args),
        rawArgs: p.args,
      }));
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
