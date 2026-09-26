import { reloadUserPlugins } from "@/lib/plugins/core/active";
import { addNotification } from "@/lib/plugins/core/notifications";
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
   request is filed with the digest of the files checked, the user gets a
   notification and a card in the thread, and only their click on the
   review screen (`/api/user-plugins/<id>/approve`) activates it — refused
   if the files changed in between.
--------------------------------------------------------------------------- */

type Args = { plugin: string };

export const pluginActivateTool: Tool<Args> = {
  name: "PluginActivate",
  policy: { gated: true, subagent: false },
  description:
    "Activates the draft of a BytNode-AI plugin you wrote, once PluginCheck passes (it is checked again). If it needs no permission beyond what the user already granted it, it runs at once. Otherwise the user must approve the permissions: they get a review card under your message and a notification — tell them, and check the outcome later with PluginRead. You never approve for them.",
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
    await addNotification(p.id, {
      title: `Review the plugin ${manifest.name}`,
      body: asks.length ? `It asks to: ${asks.join("; ")}.` : "It asks for no permission.",
      level: "warning",
      action: { kind: "review-plugin", pluginId: p.id },
    });
    const r = ok(
      `${manifest.name} is ready and waits for the user's approval${asks.length ? ` of these permissions: ${asks.join("; ")}` : ""}. A review card is under this message and a notification was sent. Tell the user in one sentence what the plugin will do and that they approve it there; do not say it is active until PluginRead says so.`,
    );
    r.card = { kind: "plugin-review", data: { pluginId: p.id, name: manifest.name } };
    return r;
  },
};
