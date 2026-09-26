import { manifestOf, readFiles, writeDraftFile } from "@/lib/plugins/user/files";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg } from "./common";

/* ---------------------------------------------------------------------------
   PluginWrite: writes one file of a plugin's DRAFT — never what runs.

   The draft only becomes the running plugin through PluginActivate, after
   PluginCheck passed and, when it asks for new permissions, after the
   user's approval. So a half-written plugin never runs, and what runs is
   exactly what was reviewed. `plugin.json` is read at once and its
   problems said in the answer.
--------------------------------------------------------------------------- */

type Args = { plugin: string; file: string; content?: string; delete?: boolean };

export const pluginWriteTool: Tool<Args> = {
  name: "PluginWrite",
  policy: { gated: true, subagent: false },
  description:
    "Writes (or deletes) one file of a BytNode-AI plugin you are writing for the user — load the create-plugin skill first: it gives the method, the ctx API, the page kit and the art direction. Files: plugin.json (manifest and permissions), server.js (export default { setup(ctx) { … } }), tests.js (required), view/index.html and view/*.css|js (its tab, optional). It writes the DRAFT: nothing runs until PluginCheck passes and PluginActivate is called. A new id creates the plugin.",
  parameters: {
    type: "object",
    properties: {
      plugin: PLUGIN_PROP,
      file: { type: "string", description: "plugin.json, server.js, tests.js, or view/<name>.html|css|js" },
      content: { type: "string", description: "The whole file's content." },
      delete: { type: "boolean", description: "true to delete the file instead." },
    },
    required: ["plugin", "file"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const p = pluginArg(args.plugin);
    if ("error" in p) return fail(p.error);
    if (!args.delete && typeof args.content !== "string") return fail("`content` is required (or `delete: true`).");
    try {
      await writeDraftFile(p.id, args.file, args.delete ? null : (args.content as string), ctx.agentId || "an agent");
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    const done = args.delete ? `Deleted ${args.file} from ${p.id}.` : `Wrote ${args.file} of ${p.id} (${Buffer.byteLength(args.content ?? "", "utf8")} bytes).`;
    if (args.file === "plugin.json" && !args.delete) {
      const m = await manifestOf(p.id, await readFiles(p.id, "draft"));
      if (!m.ok) return ok(`${done}\nplugin.json has problems to fix:\n${m.errors.map((e) => `- ${e}`).join("\n")}`);
    }
    return ok(`${done} This is the draft: the user sees no change until PluginCheck passes and PluginActivate is called.`);
  },
};
