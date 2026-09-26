import { checkUserPlugin, reportText } from "@/lib/plugins/user/check";
import { appendLog } from "@/lib/plugins/user/files";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { PLUGIN_PROP, pluginArg, takenToolNames } from "./common";

/* ---------------------------------------------------------------------------
   PluginCheck: the whole verification of a plugin's draft, in the app —
   manifest, code, a dry setup, the plugin's own tests with mocks, its
   page (`lib/plugins/user/check.ts`). Runs the plugin's code in a sandbox
   of its own with no network, no account, no user: read-only for the
   world outside.
--------------------------------------------------------------------------- */

type Args = { plugin: string };

export const pluginCheckTool: Tool<Args> = {
  name: "PluginCheck",
  policy: { readOnly: true, subagent: false },
  description:
    "Checks the draft of a BytNode-AI plugin you are writing: plugin.json, server.js, a dry run of setup(ctx) (what it registers), its tests.js with mocks (no real network, account or notification), and its page. Answers a report: ✓ per step, or the exact error and what to fix. Run it after writing, fix, run it again until everything passes — then PluginActivate.",
  parameters: { type: "object", properties: { plugin: PLUGIN_PROP }, required: ["plugin"], additionalProperties: false },
  async execute(args) {
    const p = pluginArg(args.plugin);
    if ("error" in p) return fail(p.error);
    try {
      const report = await checkUserPlugin(p.id, { taken: await takenToolNames() });
      const text = reportText(report);
      if (!report.ok) await appendLog(p.id, { source: "check", level: "warn", message: text.split("\n").filter((l) => l.includes("✗") || l.startsWith("    ")).slice(0, 6).join(" ") }).catch(() => {});
      return report.ok ? ok(text) : fail(text);
    } catch (e) {
      return fail(`The check could not run: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};
