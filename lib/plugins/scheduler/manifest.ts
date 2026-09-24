import type { PluginManifest } from "@/lib/domain/plugins";

export const schedulerManifest: PluginManifest = {
  id: "scheduler",
  name: "Scheduled tasks",
  version: "1.0.0",
  tier: "core",
  category: "automation",
  summary: "Agents and plugins that work on their own, on a schedule",
  description:
    "Ask an agent for \"a market brief every morning at 8\" and it runs by itself at that time; its report arrives as a conversation, with a notification. The same clock drives the other plugins' background work: the alerts, the portfolio's daily snapshot, the recurring purchases. Your tasks' coming runs show in the calendar. Everything runs only while BytNode-AI is open in a tab (the keys never leave your browser for the disk); a run missed while it was closed is skipped, or run once when it opens, as you choose per task. A scheduled agent gets the tools of a sub-agent: it can never place an order or move funds.",
  requires: [],
  optional: [],
  needs: [],
  config: { type: "object", properties: {} },
  views: [{ id: "scheduler", title: "Scheduled tasks", description: "Your agent tasks, the plugins' background jobs, and the recent runs." }],
  data: "Your scheduled tasks, the state of each job, and the last 500 runs with the agents' reports.",
};
