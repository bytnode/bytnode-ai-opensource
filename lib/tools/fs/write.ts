import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { windowsNameProblem } from "../file-names";
import { serialized, writeFileAtomic } from "./safe-write";

/* Write: create a file, or replace it entirely. Missing folders are
   created. To change part of a file, that is Edit. Writes are atomic and
   one at a time per file (`safe-write.ts`); a name Windows refuses or
   mangles (`CON`, `report.`) is refused (`file-names.ts`). */

type Args = { file_path: string; content: string };

export const writeTool: Tool<Args> = {
  name: "Write",
  policy: { gated: true, subagent: true },
  description:
    "Creates a file or replaces its content entirely. Intermediate folders are created. For a partial change, prefer Edit.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path of the file (relative to the workspace or absolute)." },
      content: { type: "string", description: "The complete content of the file." },
    },
    required: ["file_path", "content"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    /* `dir/` is a folder, not a file: it used to create a FILE named `dir`. */
    if (/[\\/]$/.test(args.file_path)) return fail(`${args.file_path} ends with a slash: give the path of a FILE (folders are created as needed).`);
    let target: string;
    try {
      target = resolvePath(ctx.workspace, args.file_path, ctx.scope);
    } catch (e) {
      if (e instanceof OutsideWorkspaceError) return fail(e.message);
      throw e;
    }
    const shown = displayPath(ctx.workspace, target);
    const badName = windowsNameProblem(path.basename(target));
    if (badName) return fail(`${badName}: choose another file name.`);
    return serialized(target, async () => {
      try {
        let existed = true;
        try {
          await fs.access(target);
        } catch {
          existed = false;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await writeFileAtomic(target, args.content);
        const lines = lineCount(args.content);
        return ok(`${shown} ${existed ? "replaced" : "created"} (${lines === 0 ? "empty" : `${lines} line${lines > 1 ? "s" : ""}`}).`);
      } catch (e) {
        return fail(`Could not write ${shown}: ${errorText(e)}`);
      }
    });
  },
};

/** Lines as an editor counts them: none in an empty file, and a final
    newline does not open one more. */
export const lineCount = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
