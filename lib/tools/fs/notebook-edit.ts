import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { serialized, writeFileAtomic } from "./safe-write";

/* ---------------------------------------------------------------------------
   NotebookEdit: one cell of a Jupyter notebook — replace, insert after,
   delete. The notebook is JSON (nbformat 4): a cell's source is a list of
   lines that keep their newline, except the last one. Exactly that form is
   written so Jupyter reads the file back without rewriting it.
--------------------------------------------------------------------------- */

type Cell = { cell_type: string; source: string[] | string; metadata: Record<string, unknown>; outputs?: unknown[]; execution_count?: number | null };
export type Notebook = { cells: Cell[]; metadata: Record<string, unknown>; nbformat: number; nbformat_minor: number };

type Args = {
  notebook_path: string;
  cell_index: number;
  edit_mode?: "replace" | "insert" | "delete";
  new_source?: string;
  cell_type?: "code" | "markdown";
};

export const splitSource = (text: string): string[] => {
  const lines = text.split("\n");
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l)).filter((l, i, a) => !(i === a.length - 1 && l === "" && a.length > 1));
};

export function editNotebook(
  nb: Notebook,
  edit: Omit<Args, "notebook_path">,
): { ok: true; notebook: Notebook } | { ok: false; message: string } {
  const mode = edit.edit_mode ?? "replace";
  const cells = nb.cells.slice();
  const i = edit.cell_index;
  /* `insert` goes AFTER the index: -1 puts the cell first — the only way to
     add one before the first cell, or into an empty notebook — and the
     count itself appends (read as "after the last one"). */
  const valid = mode === "insert" ? Number.isInteger(i) && i >= -1 && i <= cells.length : Number.isInteger(i) && i >= 0 && i < cells.length;
  if (!valid) {
    const hint = mode === "insert" ? " For insert, -1 puts the cell first." : "";
    return { ok: false, message: `Cell index ${i} out of range (the notebook has ${cells.length} cell${cells.length === 1 ? "" : "s"}).${hint}` };
  }
  if (mode === "delete") {
    cells.splice(i, 1);
  } else {
    if (typeof edit.new_source !== "string") return { ok: false, message: "new_source is required for replace and insert." };
    const source = splitSource(edit.new_source);
    if (mode === "replace") {
      cells[i] = { ...cells[i], source };
    } else {
      const type = edit.cell_type ?? "code";
      const cell: Cell =
        type === "code"
          ? { cell_type: "code", source, metadata: {}, outputs: [], execution_count: null }
          : { cell_type: "markdown", source, metadata: {} };
      cells.splice(Math.min(i + 1, cells.length), 0, cell);
    }
  }
  return { ok: true, notebook: { ...nb, cells } };
}

export const notebookEditTool: Tool<Args> = {
  name: "NotebookEdit",
  policy: { gated: true, subagent: true },
  description:
    "Modifies a cell of a Jupyter notebook (.ipynb): replaces its source (`replace`, default), inserts a new cell after the index (`insert`; -1 inserts it first, also into an empty notebook) or deletes it (`delete`). Indexes start at 0; read the notebook with Read to know them.",
  parameters: {
    type: "object",
    properties: {
      notebook_path: { type: "string", description: "Path of the .ipynb notebook." },
      cell_index: { type: "integer", minimum: -1, description: "Index of the target cell (0 = first). For insert: the cell to insert after, -1 = at the start." },
      edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: "Default: replace." },
      new_source: { type: "string", description: "New source of the cell (replace, insert)." },
      cell_type: { type: "string", enum: ["code", "markdown"], description: "Type of the inserted cell (insert). Default: code." },
    },
    required: ["notebook_path", "cell_index"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let target: string;
    try {
      target = resolvePath(ctx.workspace, args.notebook_path, ctx.scope);
    } catch (e) {
      if (e instanceof OutsideWorkspaceError) return fail(e.message);
      throw e;
    }
    const shown = displayPath(ctx.workspace, target);
    /* One change of a notebook at a time, written atomically (`safe-write.ts`). */
    return serialized(target, async () => {
      let nb: Notebook;
      try {
        nb = JSON.parse(await fs.readFile(target, "utf8")) as Notebook;
        if (!Array.isArray(nb.cells)) throw new Error("no `cells` list");
      } catch (e) {
        return fail(`${shown} is not a readable notebook: ${errorText(e)}`);
      }
      const out = editNotebook(nb, args);
      if (!out.ok) return fail(out.message);
      try {
        await writeFileAtomic(target, JSON.stringify(out.notebook, null, 1) + "\n");
      } catch (e) {
        return fail(`Could not write ${shown}: ${errorText(e)}`);
      }
      const n = out.notebook.cells.length;
      const done =
        args.edit_mode === "delete"
          ? `cell ${args.cell_index} deleted`
          : args.edit_mode === "insert"
            ? `new cell inserted at index ${Math.min(args.cell_index + 1, n - 1)}`
            : `cell ${args.cell_index} replaced`;
      return ok(`${shown}: ${done}. The notebook has ${n} cell${n === 1 ? "" : "s"}.`);
    });
  },
};
