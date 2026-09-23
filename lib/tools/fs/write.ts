import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";

/* Write: create a file, or replace it entirely. Missing folders are
   created. To change part of a file, that is Edit. */

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
      return ok(`${shown} ${existed ? "replaced" : "created"} (${lines} line${lines > 1 ? "s" : ""}).`);
    } catch (e) {
      return fail(`Could not write ${shown}: ${errorText(e)}`);
    }
  },
};
