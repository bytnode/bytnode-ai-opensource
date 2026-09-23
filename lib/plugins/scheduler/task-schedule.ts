import { randomUUID } from "node:crypto";
import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { describeFrequency, parseFrequency } from "../core/frequency";
import type { Session } from "../core/contract";
import { factsCard } from "../shared/cards";
import { findAgent, newTask, type AgentTask } from "./tasks";

/* TaskSchedule: the user asks for an agent to do something on its own at
   a regular interval ("a market brief every morning at 8"). Gated — it
   commits a model's time at every run — and kept from sub-agents. The run
   gets a sub-agent's tools: no order, no transfer, no Workflow. */

type Args = { title: string; prompt: string; frequency: string; agent?: string; runMissed?: boolean };

export function taskScheduleTool(add: (task: AgentTask) => Promise<void>, session: () => Session | null): Tool<Args> {
  return {
    name: "TaskSchedule",
    policy: { gated: true, subagent: false },
    description: [
      "Schedules an agent task: an agent runs `prompt` on its own at `frequency`, while the app is open, and its report reaches the user as a conversation with a notification.",
      "Frequencies: `every 30 minutes`, `every 4 hours`, `daily at 08:00`, `every monday at 09:30` (local time; at most every 15 minutes).",
      "The run gets a sub-agent's tools — it can never place an order, move funds or delegate. Each run costs the model's time (or the subscription's quota): only when the user asks for it.",
      "Write `prompt` as a complete, self-contained instruction: the agent will not have this conversation.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short name: \"Morning market brief\"." },
        prompt: { type: "string", description: "The full instruction the agent runs each time." },
        frequency: { type: "string", description: "`every N minutes|hours`, `daily at HH:MM` or `every <weekday> at HH:MM`." },
        agent: { type: "string", description: "The agent that runs it, by name or id. Default: you." },
        runMissed: { type: "boolean", description: "Run once when the app opens if a run was missed while it was closed. Default false." },
      },
      required: ["title", "prompt", "frequency"],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const agentRef = args.agent?.trim() || ctx.agentId || "";
      /* The Next server knows the agents; the MCP server of a subscription
         session does not, and the name is checked when the task runs. */
      const agents = session()?.agents;
      const agent = agents ? findAgent(agents, agentRef) : undefined;
      if (agents && !agent) return fail(`No agent "${agentRef}". The agents are: ${agents.map((a) => a.name).join(", ")}.`);
      const task = newTask({ ...args, agent: agent?.id ?? agentRef, catchUp: args.runMissed ? "run-once-on-start" : "skip" }, randomUUID().slice(0, 8), new Date());
      if ("error" in task) return fail(task.error);
      await add(task);
      const f = parseFrequency(task.frequency);
      const when = "error" in f ? task.frequency : describeFrequency(f);
      const who = agent?.name ?? task.agent;
      return {
        ...ok(`Scheduled "${task.title}" [${task.id}]: ${who}, ${when}. It runs while the app is open; the report arrives as a conversation. TaskCancel pauses or deletes it.`),
        card: factsCard("Scheduled task", [
          ["Task", task.title],
          ["Agent", who],
          ["When", when],
          ["Missed runs", task.catchUp === "run-once-on-start" ? "run once when the app opens" : "skipped"],
        ]),
      };
    },
  };
}
