import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { checkUserPlugin, reportText } from "@/lib/plugins/user/check";
import { activate, readGrant, writeRequest } from "@/lib/plugins/user/files";
import { covers, describePermissions } from "@/lib/plugins/user/permissions";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg, takenToolNames } from "./common";

/* ---------------------------------------------------------------------------
   PluginActivate: the draft becomes the running plugin.

   ⚠️ THE AGENT NEVER GRANTS A PERMISSION. The check runs again here; then
   either the plugin asks for nothing beyond what the user already granted
   (new code, same reach) and it runs at once, or the activation WAITS: a
   request is filed with the digest of the files checked, the consent block
   appears in the conversation under this call (Test / Real when it asks
   for the exchange accounts), and only the user's click there
   (`/api/user-plugins/<id>/approve`) activates it — refused if the files
   changed in between.
--------------------------------------------------------------------------- */

type Args = { plugin: string };

export const pluginActivateTool: Tool<Args> = {
  name: "PluginActivate",
  policy: { gated: true, subagent: false },
  description:
    "Activates the draft of a BytNode-AI plugin you wrote, once PluginCheck passes (it is checked again). If it needs no permission beyond what the user already granted it, it runs at once. Otherwise the user approves it in a block shown right under this call in the conversation (choosing Test or Real when it uses their exchange accounts) — tell them, and check the outcome with PluginRead. You never approve for them.",
  parameters: { type: "object", properties: { plugin: PLUGIN_PROP }, required: ["plugin"], additionalProperties: false },
  async execute(args, ctx) {
    const p = pluginArg(args.plugin);
    if ("error" in p) return fail(p.error);
    const report = await checkUserPlugin(p.id, { taken: await takenToolNames() });
    if (!report.ok || !report.manifest) return fail(`Not activated: the check fails.\n${reportText(report)}`);
    const { manifest, permissions } = report.manifest;
    const grant = await readGrant(p.id);
    const summary = [
      report.registered?.tools.length ? `tools ${report.registered.tools.map((t) => t.name).join(", ")}` : "",
      manifest.views.length ? `the tab "${manifest.views[0].title}"` : "",
      report.registered?.jobs.length ? `${report.registered.jobs.length} scheduled job(s)` : "",
    ].filter(Boolean).join(", ");

    if (grant && covers(grant.permissions, permissions)) {
      await activate(p.id, { ...grant, permissions, digest: report.digest, at: new Date().toISOString() });
      await reloadUserPlugins();
      return ok(`${manifest.name} is updated and running, under the permissions the user already granted${summary ? `: ${summary}` : ""}. Your new tools reach you from your next turn.`);
    }

    await writeRequest(p.id, {
      digest: report.digest,
      permissions,
      agentId: ctx.agentId || "",
      at: new Date().toISOString(),
      tools: (report.registered?.tools ?? []).map((t) => ({ name: t.name, readOnly: t.readOnly })),
    });
    const asks = describePermissions(permissions).map((l) => l.text);
    const money = permissions.exchange !== "none" ? " They choose there Test (testnet accounts) or Real (their live accounts)." : "";
    const r = ok(
      `${manifest.name} is ready and waits for the user's approval${asks.length ? ` of these permissions: ${asks.join("; ")}` : ""}. The approval block is shown right under this call in the conversation.${money} Tell the user in one sentence what the plugin will do and that they approve it just below; do not say it is active until PluginRead says so.`,
    );
    r.card = { kind: "plugin-review", data: { pluginId: p.id, name: manifest.name, digest: report.digest } };
    return r;
  },
};
