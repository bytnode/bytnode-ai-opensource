import fs from "node:fs/promises";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* ---------------------------------------------------------------------------
   Edit: replace an exact string in a file.

   ⚠️ THE STRING MUST BE UNIQUE. If it appears twice, there is no guessing
   which one: it is refused, the count is given, and the model widens its
   excerpt — or asks for `replace_all`. That is what makes the tool safe: it
   never modifies a place that was not designated.
--------------------------------------------------------------------------- */

type Args = { file_path: string; old_string: string; new_string: string; replace_all?: boolean };

export type EditOutcome =
  | { ok: true; content: string; count: number }
  | { ok: false; reason: "empty" | "same" | "not_found" | "ambiguous"; count?: number };

export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): EditOutcome {
  if (oldString === "") return { ok: false, reason: "empty" };
  if (oldString === newString) return { ok: false, reason: "same" };
  /* A file with Windows line endings: the model writes its excerpt with
     `\n` (Read shows no `\r`), so the excerpt never matched. It is matched
     in the file's own endings, and the replacement written in them too. */
  if (content.includes("\r\n") && !oldString.includes("\r") && oldString.includes("\n") && !content.includes(oldString)) {
    return applyEdit(content, oldString.replace(/\n/g, "\r\n"), newString.replace(/\r?\n/g, "\r\n"), replaceAll);
  }
  const count = content.split(oldString).length - 1;
  if (count === 0) return { ok: false, reason: "not_found" };
  if (count > 1 && !replaceAll) return { ok: false, reason: "ambiguous", count };
  return { ok: true, content: content.split(oldString).join(newString), count };
}

export const editTool: Tool<Args> = {
  name: "Edit",
  policy: { gated: true, subagent: true },
  description:
    "Replaces an exact string in an existing file. `old_string` must be unique in the file (widen the excerpt with surrounding context), unless `replace_all: true`, which replaces every occurrence. Read the file before modifying it.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path of the file (relative to the workspace or absolute)." },
      old_string: { type: "string", description: "The exact text to replace, indentation included." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence. Default: false." },
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
      return fail(`Could not read ${shown}: ${errorText(e)}`);
    }
    const out = applyEdit(content, args.old_string, args.new_string, args.replace_all === true);
    if (!out.ok) {
      const why = {
        empty: "old_string is empty.",
        same: "old_string and new_string are identical.",
        not_found: `old_string does not appear in ${shown}. Re-read the file: the excerpt must be exact, spaces and indentation included.`,
        ambiguous: `old_string appears ${out.count} times in ${shown}. Widen the excerpt to make it unique, or pass replace_all: true.`,
      }[out.reason];
      return fail(why);
    }
    try {
      await fs.writeFile(target, out.content, "utf8");
    } catch (e) {
      return fail(`Could not write ${shown}: ${errorText(e)}`);
    }
    return ok(`${shown}: ${out.count} replacement${out.count > 1 ? "s" : ""}.`);
  },
};
