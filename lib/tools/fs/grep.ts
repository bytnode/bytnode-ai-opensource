import { rgPath } from "@vscode/ripgrep";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { run } from "../exec/run";

/* ---------------------------------------------------------------------------
   Grep: search a pattern in the content of files, with ripgrep.

   The binary is the one from the `@vscode/ripgrep` package, so it is
   present whatever the machine. Three outputs, like ripgrep: the files that
   contain the pattern (default), the lines, or the count per file.
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
    "Searches a pattern (regular expression) in the content of files, with ripgrep. `output_mode`: `files_with_matches` (default, the files), `content` (the lines, with `context` lines around) or `count`. `glob` filters the files (`*.ts`, `**/*.{js,tsx}`).",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression (ripgrep syntax)." },
      path: { type: "string", description: "Starting file or folder. Default: the workspace." },
      glob: { type: "string", description: "Pattern of files to include." },
      output_mode: {
        type: "string",
        enum: ["files_with_matches", "content", "count"],
        description: "files_with_matches: the files that contain the pattern (default). content: the lines found, numbered. count: the number per file.",
      },
      ignore_case: { type: "boolean", description: "Ignore case." },
      context: { type: "integer", description: "Context lines before and after (content mode)." },
      multiline: { type: "boolean", description: "The pattern may span several lines." },
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
      if (r.code === 1 && !r.stdout.trim()) return ok(`No match for /${args.pattern}/ in ${displayPath(ctx.workspace, root)}.`);
      if (r.code !== 0 && r.code !== 1) return fail(`ripgrep failed (code ${r.code}): ${r.stderr.trim() || "no message"}`);
      const lines = r.stdout
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
        .map((l) => shorten(l, ctx.workspace));
      const more = lines.length > LIMIT_LINES ? `\n[… ${lines.length - LIMIT_LINES} more lines]` : "";
      return ok(lines.slice(0, LIMIT_LINES).join("\n") + more);
    } catch (e) {
      return fail(`Grep failed: ${errorText(e)}`);
    }
  },
};

/* ripgrep prints the paths as it was given them (absolute): they are
   brought back to the workspace so the model reuses them as they are. */
function shorten(line: string, workspace: string): string {
  const drive = /^[A-Za-z]:[\\/]/.test(line) ? line.match(/^([A-Za-z]:[\\/][^:]*)(:.*)?$/) : null;
  if (drive) return displayPath(workspace, drive[1]) + (drive[2] ?? "");
  if (line.startsWith("/")) {
    const m = line.match(/^([^:]+)(:.*)?$/);
    if (m) return displayPath(workspace, m[1]) + (m[2] ?? "");
  }
  return line;
}
