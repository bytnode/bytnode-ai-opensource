import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* ---------------------------------------------------------------------------
   Edit : remplacer une chaine exacte dans un fichier.

   ⚠️ LA CHAINE DOIT ETRE UNIQUE. Si elle apparait deux fois, on ne devine
   pas laquelle : on refuse, on dit combien, et le modele elargit son extrait
   — ou demande `replace_all`. C'est ce qui rend l'outil sur : il ne modifie
   jamais un endroit qu'on n'a pas designe.
--------------------------------------------------------------------------- */

type Args = { file_path: string; old_string: string; new_string: string; replace_all?: boolean };

export type EditOutcome =
  | { ok: true; content: string; count: number }
  | { ok: false; reason: "empty" | "same" | "not_found" | "ambiguous"; count?: number };

export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): EditOutcome {
  if (oldString === "") return { ok: false, reason: "empty" };
  if (oldString === newString) return { ok: false, reason: "same" };
  const count = content.split(oldString).length - 1;
  if (count === 0) return { ok: false, reason: "not_found" };
  if (count > 1 && !replaceAll) return { ok: false, reason: "ambiguous", count };
  return { ok: true, content: content.split(oldString).join(newString), count };
}

export const editTool: Tool<Args> = {
  name: "Edit",
  description:
    "Remplace une chaîne exacte dans un fichier existant. `old_string` doit être unique dans le fichier (élargissez l'extrait avec du contexte autour), sauf avec `replace_all: true` qui remplace toutes les occurrences. Lisez le fichier avant de le modifier.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Chemin du fichier (relatif au dossier de travail ou absolu)." },
      old_string: { type: "string", description: "Le texte exact à remplacer, indentation comprise." },
      new_string: { type: "string", description: "Le texte de remplacement." },
      replace_all: { type: "boolean", description: "Remplacer toutes les occurrences. Par défaut : false." },
    },
    required: ["file_path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let target: string;
    try {
      target = resolvePath(ctx.workspace, args.file_path, ctx.scope);
    } catch (e) {
      if (e instanceof OutsideWorkspaceError) return fail(e.message);
      throw e;
    }
    const shown = displayPath(ctx.workspace, target);
    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (e) {
      return fail(`Impossible de lire ${shown} : ${errorText(e)}`);
    }
    const out = applyEdit(content, args.old_string, args.new_string, args.replace_all === true);
    if (!out.ok) {
      const why = {
        empty: "old_string est vide.",
        same: "old_string et new_string sont identiques.",
        not_found: `old_string n'apparaît pas dans ${shown}. Relisez le fichier : l'extrait doit être exact, espaces et indentation compris.`,
        ambiguous: `old_string apparaît ${out.count} fois dans ${shown}. Élargissez l'extrait pour le rendre unique, ou passez replace_all: true.`,
      }[out.reason];
      return fail(why);
    }
    try {
      await fs.writeFile(target, out.content, "utf8");
    } catch (e) {
      return fail(`Impossible d'écrire ${shown} : ${errorText(e)}`);
    }
    return ok(`${shown} : ${out.count} remplacement${out.count > 1 ? "s" : ""}.`);
  },
};
