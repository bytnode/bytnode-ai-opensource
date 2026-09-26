import { activeRuntime } from "@/lib/plugins/core/active";
import { digestOf, manifestOf, readFiles, readGrant, readLog, readMeta, readRequest, userPluginIds } from "@/lib/plugins/user/files";
import { describePermissions } from "@/lib/plugins/user/permissions";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg } from "./common";

/* ---------------------------------------------------------------------------
   PluginRead: the plugins the user's agents wrote — the list, one
   plugin's state and files, or one file. What an agent reads before
   changing a plugin, and after asking for its activation (was it
   approved?). The shipped plugins are not here: they are not the agents'
   to change.
--------------------------------------------------------------------------- */

type Args = { plugin?: string; file?: string };

async function stateOf(id: string): Promise<string> {
  const [grant, request] = await Promise.all([readGrant(id), readRequest(id)]);
  const status = activeRuntime()?.status().find((s) => s.id === id);
  if (request) return "waiting for the user's approval";
  if (!grant) return "draft (never activated)";
  if (status?.state === "error") return `active but failing: ${status.message ?? "error"}`;
  if (status?.state === "disabled") return "approved, switched off by the user";
  return "active";
}

export const pluginReadTool: Tool<Args> = {
  name: "PluginRead",
  policy: { readOnly: true, subagent: false },
  description:
    "Reads the BytNode-AI plugins written by the user's agents (the create-plugin skill explains how to write one). Without `plugin`: the list, with each one's state. With `plugin`: its state, granted permissions, files and the last errors of its code or page. With `plugin` and `file`: that file's content (the draft the agent edits).",
  parameters: {
    type: "object",
    properties: {
      plugin: PLUGIN_PROP,
      file: { type: "string", description: "A file of the plugin: plugin.json, server.js, tests.js, view/index.html…" },
    },
    additionalProperties: false,
  },
  async execute(args) {
    if (!args.plugin) {
      const ids = await userPluginIds();
      if (!ids.length) return ok("No plugin written by an agent yet. To write one, load the create-plugin skill.");
      const rows: string[] = [];
      for (const id of ids) {
        const files = await readFiles(id, "draft").catch(() => ({}));
        const m = await manifestOf(id, files);
        const meta = await readMeta(id);
        rows.push(`- ${id} — ${m.ok ? `${m.value.manifest.name}: ${m.value.manifest.summary}` : "(plugin.json not valid yet)"} · ${await stateOf(id)}${meta ? ` · changed ${meta.updatedAt.slice(0, 10)} by ${meta.updatedBy}` : ""}`);
      }
      return ok(`Plugins written by agents:\n${rows.join("\n")}`);
    }
    const p = pluginArg(args.plugin);
    if ("error" in p) return fail(p.error);
    const files = await readFiles(p.id, "draft").catch(() => ({}) as Record<string, string>);
    if (args.file) {
      const text = files[args.file];
      if (text === undefined) return fail(`${p.id} has no file ${args.file}. Files: ${Object.keys(files).join(", ") || "none"}.`);
      return ok(text);
    }
    if (!Object.keys(files).length && !(await userPluginIds()).includes(p.id)) return fail(`No plugin ${p.id}. Create it with PluginWrite (start with plugin.json).`);
    const grant = await readGrant(p.id);
    const log = (await readLog(p.id, 12)).filter((l) => l.level !== "info");
    const lines = [
      `${p.id}: ${await stateOf(p.id)}${grant && Object.keys(files).length && digestOf(files) !== grant.digest ? " — the draft has changes NOT activated yet (PluginCheck, then PluginActivate)" : ""}`,
      `Files: ${Object.entries(files).map(([n, t]) => `${n} (${Math.ceil(t.length / 1024)} kB)`).join(", ") || "none"}`,
      `Granted: ${grant ? describePermissions(grant.permissions).map((l) => l.text).join("; ") || "no permission" : "nothing yet"}${grant?.accounts.length ? ` · ${grant.accounts.length} account(s)` : ""}`,
    ];
    if (log.length) lines.push("Recent problems:", ...log.map((l) => `  ${l.at.slice(0, 16).replace("T", " ")} [${l.source}] ${l.message}`));
    return ok(lines.join("\n"));
  },
};
