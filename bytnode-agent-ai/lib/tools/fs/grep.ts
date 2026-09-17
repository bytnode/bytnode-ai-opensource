import { rgPath } from "@vscode/ripgrep";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { run } from "../exec/run";

/* ---------------------------------------------------------------------------
   Grep : chercher un motif dans le contenu des fichiers, avec ripgrep.

   Le binaire est celui du paquet `@vscode/ripgrep`, donc present quelle que
   soit la machine. Trois sorties, comme ripgrep : les fichiers qui
   contiennent le motif (par defaut), les lignes, ou le compte par fichier.
--------------------------------------------------------------------------- */

type Args = {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "files_with_matches" | "content" | "count";
  ignore_case?: boolean;
  context?: number;
  multiline?: boolean;
};

const LIMIT_LINES = 400;

export const grepTool: Tool<Args> = {
  name: "Grep",
  description:
    "Recherche un motif (expression régulière) dans le contenu des fichiers, avec ripgrep. `output_mode` : `files_with_matches` (défaut, les fichiers), `content` (les lignes, avec `context` lignes autour) ou `count`. `glob` filtre les fichiers (`*.ts`, `**/*.{js,tsx}`).",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Expression régulière (syntaxe ripgrep)." },
      path: { type: "string", description: "Fichier ou dossier de départ. Par défaut : le dossier de travail." },
      glob: { type: "string", description: "Motif de fichiers à inclure." },
      output_mode: {
        type: "string",
        enum: ["files_with_matches", "content", "count"],
        description: "files_with_matches : les fichiers qui contiennent le motif (défaut). content : les lignes trouvées, numérotées. count : le nombre par fichier.",
      },
      ignore_case: { type: "boolean", description: "Ignorer la casse." },
      context: { type: "integer", description: "Lignes de contexte avant et après (mode content)." },
      multiline: { type: "boolean", description: "Le motif peut s'étendre sur plusieurs lignes." },
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
    const mode = args.output_mode ?? "files_with_matches";
    const rgArgs = ["--no-messages", "--color=never", "--hidden", "--glob=!.git", "--glob=!node_modules", "--glob=!.next"];
    if (mode === "files_with_matches") rgArgs.push("-l");
    else if (mode === "count") rgArgs.push("-c");
    else rgArgs.push("-n", "--heading");
    if (args.ignore_case) rgArgs.push("-i");
    if (args.multiline) rgArgs.push("-U", "--multiline-dotall");
    if (mode === "content" && args.context) rgArgs.push("-C", String(args.context));
    if (args.glob) rgArgs.push("--glob", args.glob);
    rgArgs.push("-e", args.pattern, root);

    try {
      const r = await run(rgPath, rgArgs, { cwd: ctx.workspace, timeoutMs: 60_000, signal: ctx.signal });
      if (r.code === 1 && !r.stdout.trim()) return ok(`Aucune correspondance pour /${args.pattern}/ dans ${displayPath(ctx.workspace, root)}.`);
      if (r.code !== 0 && r.code !== 1) return fail(`ripgrep a échoué (code ${r.code}) : ${r.stderr.trim() || "sans message"}`);
      const lines = r.stdout
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
        .map((l) => shorten(l, ctx.workspace));
      const more = lines.length > LIMIT_LINES ? `\n[… ${lines.length - LIMIT_LINES} lignes de plus]` : "";
      return ok(lines.slice(0, LIMIT_LINES).join("\n") + more);
    } catch (e) {
      return fail(`Grep a échoué : ${errorText(e)}`);
    }
  },
};

/* ripgrep imprime les chemins tels qu'on les lui a donnes (absolus) : on les
   ramene au dossier de travail pour que le modele les reutilise tels quels. */
function shorten(line: string, workspace: string): string {
  const drive = /^[A-Za-z]:[\\/]/.test(line) ? line.match(/^([A-Za-z]:[\\/][^:]*)(:.*)?$/) : null;
  if (drive) return displayPath(workspace, drive[1]) + (drive[2] ?? "");
  if (line.startsWith("/")) {
    const m = line.match(/^([^:]+)(:.*)?$/);
    if (m) return displayPath(workspace, m[1]) + (m[2] ?? "");
  }
  return line;
}
