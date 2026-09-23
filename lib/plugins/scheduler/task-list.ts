import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import { shortDate, taskLines, type AgentTask, type RunState } from "./tasks";

/* TaskList: the user's scheduled agent tasks and the plugins' background
   jobs, with their last and next run. Read-only. */

export type Overview = {
  tasks: AgentTask[];
  jobs: Array<{ id: string; title: string; every: string }>;
  states: Record<string, RunState>;
};

export function taskListTool(overview: () => Promise<Overview>): Tool<Record<string, never>> {
  return {
    name: "TaskList",
    policy: { readOnly: true, subagent: true },
    description: "Lists the scheduled agent tasks (title, id, agent, frequency, last and next run, status) and the background jobs of the plugins. Times are the machine's local time.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const { tasks, jobs, states } = await overview();
      const jobLines = jobs.map((j) => {
        const s = states[j.id] ?? {};
        const last = s.lastRun ? `last ${shortDate(s.lastRun)}${s.lastStatus === "failed" ? ` (failed: ${s.lastMessage ?? "?"})` : ""}` : "never run";
        return `- ${j.title} — ${j.every}; ${last}; next ${shortDate(s.nextRun)}`;
      });
      return ok(
        [
          tasks.length ? `Scheduled agent tasks (${tasks.length}):\n${taskLines(tasks, states).join("\n")}` : "No scheduled agent task.",
          jobs.length ? `Background jobs of the plugins:\n${jobLines.join("\n")}` : "",
          "They run only while the app is open.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    },
  };
}
