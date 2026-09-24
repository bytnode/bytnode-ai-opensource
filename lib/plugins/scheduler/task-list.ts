import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { taskLines, type AgentTask, type RunState } from "./tasks";

/* TaskList: the user's scheduled agent tasks, with their last and next
   run. Read-only. (The plugins' background jobs are not scheduled tasks:
   they are not listed.) */

export type Overview = {
  tasks: AgentTask[];
  states: Record<string, RunState>;
};

export function taskListTool(overview: () => Promise<Overview>): Tool<Record<string, never>> {
  return {
    name: "TaskList",
    policy: { readOnly: true, subagent: true },
    description: "Lists the scheduled agent tasks (title, id, agent, frequency, last and next run, status). Times are the machine's local time.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const { tasks, states } = await overview();
      return ok([tasks.length ? `Scheduled agent tasks (${tasks.length}):\n${taskLines(tasks, states).join("\n")}` : "No scheduled agent task.", "They run only while the app is open."].join("\n\n"));
    },
  };
}
