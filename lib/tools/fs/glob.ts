import fg from "fast-glob";
import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* Glob: find files by pattern, the most recently modified first — they
   are almost always the ones being looked for. */

type Args = { pattern: string; path?: string };

const LIMIT = 300;
const IGNORE = ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**", "**/build/**"];

export const globTool: Tool<Args> = {
  name: "Glob",
  policy: { readOnly: true, subagent: true },
  description:
    "Searches for files by pattern (`**/*.ts`, `src/**/*.test.tsx`, `*.md`…) in a folder. Returns the paths, from the most recently modified to the oldest. node_modules, .git, .next, dist and build are ignored.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern." },
      path: { type: "string", description: "Starting folder. Default: the workspace." },
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
      if (list.length === 0) return ok(`No file matches ${args.pattern} in ${displayPath(ctx.workspace, root)}.`);
      const more = withTime.length > LIMIT ? `\n[… ${withTime.length - LIMIT} more]` : "";
      return ok(list.join("\n") + more);
    } catch (e) {
      return fail(`Glob failed: ${errorText(e)}`);
    }
  },
};
