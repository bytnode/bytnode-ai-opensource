import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";

/* EventRefresh: asks for a collection now — of the next 7 days, or of the
   next 30. The collection is the calendar's background job: it runs in
   the app (never twice at once) and fills the table a few minutes later. */

type Args = { days?: 7 | 30 };

export function eventRefreshTool(refresh: (days: 7 | 30) => Promise<void>): Tool<Args> {
  return {
    name: "EventRefresh",
    policy: { readOnly: true, subagent: true },
    description: "Asks for a new collection of the market events of the next 7 days (default) or 30 days. It runs in the background while the app is open and takes a few minutes; EventSearch answers from the table meanwhile.",
    parameters: {
      type: "object",
      properties: { days: { type: "integer", enum: [7, 30], description: "The period to collect (default 7)." } },
      additionalProperties: false,
    },
    async execute(args) {
      const days = args.days ?? 7;
      await refresh(days);
      return ok(`Collection of the next ${days} days requested: the events arrive in a few minutes, while the app is open. EventSearch answers from the table meanwhile.`);
    },
  };
}
