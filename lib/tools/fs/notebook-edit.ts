import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* ---------------------------------------------------------------------------
   NotebookEdit : une cellule d'un carnet Jupyter — remplacer, inserer apres,
   supprimer. Le carnet est du JSON (nbformat 4) : la source d'une cellule
   est une liste de lignes qui gardent leur retour a la ligne, sauf la
   derniere. On ecrit exactement cette forme pour que Jupyter relise le
   fichier sans le reecrire.
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
  if (!Number.isInteger(i) || i < 0 || i >= cells.length) {
    return { ok: false, message: `Index de cellule ${i} hors limites (le carnet a ${cells.length} cellules).` };
  }
  if (mode === "delete") {
    cells.splice(i, 1);
  } else {
    if (typeof edit.new_source !== "string") return { ok: false, message: "new_source est requis pour replace et insert." };
    const source = splitSource(edit.new_source);
    if (mode === "replace") {
      cells[i] = { ...cells[i], source };
    } else {
      const type = edit.cell_type ?? "code";
      const cell: Cell =
        type === "code"
          ? { cell_type: "code", source, metadata: {}, outputs: [], execution_count: null }
          : { cell_type: "markdown", source, metadata: {} };
      cells.splice(i + 1, 0, cell);
    }
  }
  return { ok: true, notebook: { ...nb, cells } };
}

export const notebookEditTool: Tool<Args> = {
  name: "NotebookEdit",
  description:
    "Modifie une cellule d'un carnet Jupyter (.ipynb) : remplace sa source (`replace`, par défaut), insère une nouvelle cellule après l'index (`insert`) ou la supprime (`delete`). Les index commencent à 0 ; lisez le carnet avec Read pour les connaître.",
  parameters: {
    type: "object",
    properties: {
      notebook_path: { type: "string", description: "Chemin du carnet .ipynb." },
      cell_index: { type: "integer", description: "Index de la cellule visée (0 = première)." },
      edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: "Par défaut : replace." },
      new_source: { type: "string", description: "Nouvelle source de la cellule (replace, insert)." },
      cell_type: { type: "string", enum: ["code", "markdown"], description: "Type de la cellule insérée (insert). Par défaut : code." },
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
    let nb: Notebook;
    try {
      nb = JSON.parse(await fs.readFile(target, "utf8")) as Notebook;
      if (!Array.isArray(nb.cells)) throw new Error("pas de liste `cells`");
    } catch (e) {
      return fail(`${shown} n'est pas un carnet lisible : ${errorText(e)}`);
    }
    const out = editNotebook(nb, args);
    if (!out.ok) return fail(out.message);
    try {
      await fs.writeFile(target, JSON.stringify(out.notebook, null, 1) + "\n", "utf8");
    } catch (e) {
      return fail(`Impossible d'écrire ${shown} : ${errorText(e)}`);
    }
    return ok(`${shown} : cellule ${args.cell_index} ${args.edit_mode === "delete" ? "supprimée" : args.edit_mode === "insert" ? "insérée après" : "remplacée"}. Le carnet a ${out.notebook.cells.length} cellules.`);
  },
};
