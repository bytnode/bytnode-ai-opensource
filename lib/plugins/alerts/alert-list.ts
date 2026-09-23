import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { alertLine, type Alert, type Trigger } from "./alerts";

/* AlertList: the alerts, their state (fired, cannot be checked), and the
   last ones that fired. Read-only. */

const RECENT = 10;

export function alertListTool(read: () => Promise<{ alerts: Alert[]; triggers: Trigger[] }>): Tool<Record<string, never>> {
  return {
    name: "AlertList",
    policy: { readOnly: true, subagent: true },
    description: "Lists the user's market alerts (asset, condition, once or recurring, active or done, when they fired, whether they can be checked) and the last ones that fired.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const { alerts, triggers } = await read();
      const active = alerts.filter((a) => a.status === "active");
      const done = alerts.filter((a) => a.status === "done");
      const recent = triggers.slice(-RECENT).reverse();
      return ok(
        [
          active.length ? `Active alerts (${active.length}):\n${active.map(alertLine).join("\n")}` : "No active alert.",
          done.length ? `Done (fired once):\n${done.map(alertLine).join("\n")}` : "",
          recent.length ? `Last fired:\n${recent.map((t) => `- ${t.at.slice(0, 16).replace("T", " ")} UTC — ${t.symbol} ${t.condition}: ${t.observed}`).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    },
  };
}
