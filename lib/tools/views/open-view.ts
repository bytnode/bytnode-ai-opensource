import type { PluginView } from "@/lib/domain/plugins";
import type { Tool } from "../types";
import { fail, ok } from "../types";

/* ---------------------------------------------------------------------------
   OpenView: the agent opens a plugin's tab for the user.

   "Show me my portfolio" — the agent calls this tool, and the browser, on
   its result, opens the Portfolio tab (or switches to it), with the
   parameters given (an account, a week, an asset); the thread keeps a
   card to come back to it. The tool itself only checks that the view
   exists: opening is the browser's job, which reads the call's arguments —
   the same for an OpenRouter agent and for a subscription agent, whose
   call arrives as `mcp__bytnode-ai__OpenView`.

   Read-only, never for a sub-agent nor a background run: a scheduled task
   must not open tabs while the user is working.
--------------------------------------------------------------------------- */

export const OPEN_VIEW = "OpenView";

type Args = { view: string; params?: Record<string, unknown> };

export function openViewTool(views: PluginView[]): Tool<Args> {
  return {
    name: OPEN_VIEW,
    policy: { readOnly: true, subagent: false },
    description:
      "Opens one of BytNode-AI's views in its own tab, next to the conversation, for the user to consult without asking you: " +
      views.map((v) => `\`${v.id}\` (${v.description})`).join("; ") +
      ". Use it when the user asks to see, show or open one of them. `params` narrows the view when it supports it (an asset, an account, a date).",
    parameters: {
      type: "object",
      properties: {
        view: { type: "string", enum: views.map((v) => v.id), description: "The view to open." },
        params: { type: "object", additionalProperties: true, description: "Optional: what to show first (e.g. {\"symbol\": \"BTC/USDT\"})." },
      },
      required: ["view"],
      additionalProperties: false,
    },
    async execute(args) {
      const view = views.find((v) => v.id === args.view);
      if (!view) return fail(`Unknown view: ${args.view}. Available: ${views.map((v) => v.id).join(", ")}.`);
      return ok(`The ${view.title} tab is open for the user. Do not repeat what it shows; answer what they asked, if anything remains.`);
    },
  };
}
