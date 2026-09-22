import type { ToolCallFragment } from "@/lib/llm/sse";

/* ---------------------------------------------------------------------------
   Stitching tool calls back together.

   The stream sends them in pieces, by index: one fragment carries the id
   and the name, the following ones add the arguments character by
   character. They are glued back by index, and the JSON is only parsed at
   the end.
--------------------------------------------------------------------------- */

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArgs: string;
  /** The arguments received were not readable JSON: `args` is empty by
      default, and the model must learn it as such. */
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

  /** Forget what was stitched: a turn retried after a transient error
      starts from scratch, otherwise the fragments would get mixed up. */
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
    return { args: {}, error: "the arguments must be a JSON object" };
  } catch (e) {
    return { args: {}, error: `unreadable JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}
