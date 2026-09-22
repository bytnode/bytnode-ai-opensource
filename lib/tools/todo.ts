import type { PlanEntry } from "@/lib/agent/events";
import type { Tool } from "./types";
import { fail, ok } from "./types";

/* ---------------------------------------------------------------------------
   TodoWrite: the task list the agent sets for itself.

   On a long task (collect → test → plot → write up), the model loses the
   thread and the user cannot see where it stands. The list, sent back IN
   FULL on every call, is published as a `plan` — the same event as the
   subscription agents, rendered by the same block in the thread, never
   replayed to the model (`history.ts`). The model receives it as text.

   Pure: no disk, no network. The state is the last call.
--------------------------------------------------------------------------- */

const STATUSES: PlanEntry["status"][] = ["pending", "in_progress", "completed"];
const MARK: Record<PlanEntry["status"], string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };

type Args = { todos: Array<{ content: string; status: string }> };

export const todoTool: Tool<Args> = {
  name: "TodoWrite",
  description:
    "Your task list for the work in progress, shown to the user. Send the COMPLETE list on every call (it replaces the previous one). " +
    "Use it as soon as a request has more than two steps: write the steps down before starting, set ONE task to `in_progress` when you tackle it, to `completed` as soon as it is done. " +
    "An empty list clears the plan.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The tasks, in order.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "The task, short, in the imperative." },
            status: { type: "string", enum: STATUSES },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const entries: PlanEntry[] = [];
    for (const [i, t] of (args.todos ?? []).entries()) {
      if (typeof t !== "object" || t === null) return fail(`\`todos[${i}]\`: object { content, status } expected.`);
      if (typeof t.content !== "string" || !t.content.trim()) return fail(`\`todos[${i}].content\`: non-empty text expected.`);
      if (!STATUSES.includes(t.status as PlanEntry["status"])) return fail(`\`todos[${i}].status\`: ${STATUSES.join(", ")} expected, got ${JSON.stringify(t.status)}.`);
      entries.push({ content: t.content.trim(), status: t.status as PlanEntry["status"] });
    }
    if (entries.filter((e) => e.status === "in_progress").length > 1) {
      return fail("Only one task `in_progress` at a time: finish (or set back to `pending`) the others.");
    }
    ctx.emit({ type: "plan", entries });
    if (entries.length === 0) return ok("List cleared.");
    const done = entries.filter((e) => e.status === "completed").length;
    const head = `List updated (${done}/${entries.length} done):`;
    return ok([head, ...entries.map((e) => `${MARK[e.status]} ${e.content}`)].join("\n"));
  },
};
