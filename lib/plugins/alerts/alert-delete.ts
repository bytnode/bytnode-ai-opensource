import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { Alert } from "./alerts";

/* AlertDelete: removes an alert (`all`: every one). */

type Args = { id: string };

export function alertDeleteTool(remove: (id: string) => Promise<Alert[]>): Tool<Args> {
  return {
    name: "AlertDelete",
    policy: { gated: false, subagent: false },
    description: "Deletes a market alert by its id (AlertList shows them), or `all`.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The alert's id, or `all`." } },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(args) {
      const removed = await remove(args.id.trim());
      if (removed.length === 0) return fail(`No alert "${args.id}". AlertList shows them.`);
      return ok(`Deleted: ${removed.map((a) => `[${a.id}] ${a.target} ${a.condition}`).join("; ")}.`);
    },
  };
}
