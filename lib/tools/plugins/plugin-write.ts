import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { checkUserPlugin } from "@/lib/plugins/user/check";
import { activate, manifestOf, readFiles, readGrant, readRequest, writeDraftFile } from "@/lib/plugins/user/files";
import { covers } from "@/lib/plugins/user/permissions";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg, takenToolNames } from "./common";

/* ---------------------------------------------------------------------------
   PluginWrite: writes one file of a plugin's DRAFT.

   A plugin the user already approved is updated LIVE: when the draft, with
   this file, passes the whole check and asks for nothing beyond what was
   granted, it becomes what runs at once — the open tab reloads within
   seconds, the tools change at the agents' next message. Otherwise the
   draft waits: a failing check says why; a new permission needs
   PluginActivate and the user's approval in the conversation. A
   half-written plugin never runs, and what runs always passed the check
   under what the user granted. `plugin.json` is read at once and its
   problems said in the answer.
--------------------------------------------------------------------------- */

type Args = { plugin: string; file: string; content?: string; delete?: boolean };

export const pluginWriteTool: Tool<Args> = {
  name: "PluginWrite",
  policy: { gated: true, subagent: false },
  description:
    "Writes (or deletes) one WHOLE file of a BytNode-AI plugin you are writing for the user — there is no partial edit: PluginRead the file, then write it complete. A plugin's files are not in your workspace: never use Read, Edit or Write on them. Before anything, load the create-plugin skill (the method, the ctx API, tests, activation) and, for view/ files, the plugin-design skill (layout, backdrop, centring, kit, art direction). Files: plugin.json (manifest and permissions), server.js (export default { setup(ctx) { … } }), tests.js (required), view/index.html and view/*.css|js (its tab, optional). A new plugin stays a draft until PluginActivate and the user's approval. An already approved plugin is updated LIVE as soon as the draft passes the check and asks for no new permission: the answer says whether it went live.",
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
    return ok(`${done} ${await goLive(p.id)}`);
  },
};

/** An approved plugin whose draft passes and asks nothing new: it runs now. */
async function goLive(id: string): Promise<string> {
  const grant = await readGrant(id);
  if (!grant) return "Draft only (never activated): when it is complete, PluginCheck then PluginActivate.";
  const report = await checkUserPlugin(id, { taken: await takenToolNames() });
  if (!report.ok || !report.manifest) {
    const failed = report.steps.find((s) => !s.ok);
    return `Not live yet — the draft does not pass the check${failed ? ` (${failed.name}: ${failed.lines[0] ?? "failed"})` : ""}. The user still sees the previous version. Run PluginCheck for the details.`;
  }
  if (!covers(grant.permissions, report.manifest.permissions)) return "Not live: it asks for a new permission. PluginActivate — the user approves it in the conversation.";
  if (report.digest === grant.digest) return "Live already: this is the version that runs.";
  if (await readRequest(id)) return "Not live: an approval is pending for this plugin. PluginActivate again once done.";
  await activate(id, { ...grant, permissions: grant.permissions, digest: report.digest, at: new Date().toISOString() });
  await reloadUserPlugins();
  return "LIVE: the running plugin is updated — its open tab reloads within seconds, its tools change at the agents' next message.";
}
