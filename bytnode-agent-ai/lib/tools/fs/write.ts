import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* Write : creer un fichier, ou le remplacer entierement. Les dossiers
   manquants sont crees. Pour changer une partie d'un fichier, c'est Edit. */

type Args = { file_path: string; content: string };

export const writeTool: Tool<Args> = {
  name: "Write",
  description:
    "Crée un fichier ou remplace entièrement son contenu. Les dossiers intermédiaires sont créés. Pour une modification partielle, préférez Edit.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Chemin du fichier (relatif au dossier de travail ou absolu)." },
      content: { type: "string", description: "Le contenu complet du fichier." },
    },
    required: ["file_path", "content"],
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
    try {
      let existed = true;
      try {
        await fs.access(target);
      } catch {
        existed = false;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, args.content, "utf8");
      const lines = args.content.split("\n").length;
      return ok(`${shown} ${existed ? "remplacé" : "créé"} (${lines} ligne${lines > 1 ? "s" : ""}).`);
    } catch (e) {
      return fail(`Impossible d'écrire ${shown} : ${errorText(e)}`);
    }
  },
};
