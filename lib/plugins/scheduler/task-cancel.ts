import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { AgentTask, TaskAction } from "./tasks";

/* TaskCancel: pauses, resumes or deletes a scheduled agent task. Gated,
   and kept from sub-agents: what runs on the user's behalf is theirs to
   decide. */

type Args = { task: string; action?: TaskAction };

export function taskCancelTool(change: (ref: string, action: TaskAction) => Promise<{ task: AgentTask } | { error: string }>): Tool<Args> {
  return {
    name: "TaskCancel",
    policy: { gated: true, subagent: false },
    description: "Deletes a scheduled agent task, or pauses / resumes it. `task` is its id or its exact title (TaskList shows both).",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task's id or title." },
        action: { type: "string", enum: ["delete", "pause", "resume"], description: "Default: delete." },
      },
      required: ["task"],
      additionalProperties: false,
    },
    async execute(args) {
      const action = args.action ?? "delete";
      const r = await change(args.task, action);
      if ("error" in r) return fail(r.error);
      const done = action === "delete" ? "deleted" : action === "pause" ? "paused" : "resumed";
      return ok(`"${r.task.title}" [${r.task.id}] ${done}.`);
    },
  };
}
