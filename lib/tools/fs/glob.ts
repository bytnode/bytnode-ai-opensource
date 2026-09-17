import fg from "fast-glob";
import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* Glob : trouver des fichiers par motif, les plus recemment modifies en
   tete — c'est presque toujours ceux qu'on cherche. */

type Args = { pattern: string; path?: string };

const LIMIT = 300;
const IGNORE = ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**", "**/build/**"];

export const globTool: Tool<Args> = {
  name: "Glob",
  description:
    "Recherche des fichiers par motif (`**/*.ts`, `src/**/*.test.tsx`, `*.md`…) dans un dossier. Rend les chemins, du plus récemment modifié au plus ancien. node_modules, .git, .next, dist et build sont ignorés.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Motif glob." },
      path: { type: "string", description: "Dossier de départ. Par défaut : le dossier de travail." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let root: string;
    try {
      root = resolvePath(ctx.workspace, args.path ?? ".", ctx.scope);
    } catch (e) {
      if (e instanceof OutsideWorkspaceError) return fail(e.message);
      throw e;
    }
    try {
      const found = await fg(args.pattern, { cwd: root, absolute: true, dot: true, ignore: IGNORE, onlyFiles: true, suppressErrors: true });
      const withTime = await Promise.all(
        found.map(async (f) => ({ f, t: (await fs.stat(f).catch(() => null))?.mtimeMs ?? 0 })),
      );
      withTime.sort((a, b) => b.t - a.t);
      const list = withTime.slice(0, LIMIT).map(({ f }) => displayPath(ctx.workspace, f));
      if (list.length === 0) return ok(`Aucun fichier ne correspond à ${args.pattern} dans ${displayPath(ctx.workspace, root)}.`);
      const more = withTime.length > LIMIT ? `\n[… ${withTime.length - LIMIT} de plus]` : "";
      return ok(list.join("\n") + more);
    } catch (e) {
      return fail(`Glob a échoué : ${errorText(e)}`);
    }
  },
};
