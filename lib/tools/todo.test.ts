import { describe, expect, test } from "vitest";
import { todoTool } from "./todo";
import type { ToolContext } from "./types";
import type { AgentEvent } from "@/lib/agent/events";

/* The agent's task list: what it sends is shown in the thread (the same
   "plan" block as the subscription agents) and comes back to it as text,
   so it knows where it stands. */

const ctx = (events: AgentEvent[]): ToolContext => ({
  workspace: "C:/w",
  scope: "workspace",
  projectRoot: "C:/p",
  signal: new AbortController().signal,
  emit: (e) => events.push(e),
  depth: 0,
  llm: { apiKey: "", model: "m", effort: null },
  callId: "c1",
});

describe("TodoWrite", () => {
  test("publishes the list as a plan and returns it to the model", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute(
      {
        todos: [
          { content: "Read the CSVs", status: "completed" },
          { content: "Run the backtest", status: "in_progress" },
          { content: "Plot the curve", status: "pending" },
        ],
      },
      ctx(events),
    );
    expect(res.ok).toBe(true);
    expect(events).toEqual([
      {
        type: "plan",
        entries: [
          { content: "Read the CSVs", status: "completed" },
          { content: "Run the backtest", status: "in_progress" },
          { content: "Plot the curve", status: "pending" },
        ],
      },
    ]);
    expect(res.output).toBe("List updated (1/3 done):\n[x] Read the CSVs\n[>] Run the backtest\n[ ] Plot the curve");
  });

  test("refuses an entry without content or with an unknown status, publishing nothing", async () => {
    const events: AgentEvent[] = [];
    const empty = await todoTool.execute({ todos: [{ content: "  ", status: "pending" }] }, ctx(events));
    expect(empty.ok).toBe(false);
    expect(empty.output).toContain("todos[0].content");
    const status = await todoTool.execute({ todos: [{ content: "x", status: "done" }] }, ctx(events));
    expect(status.ok).toBe(false);
    expect(status.output).toContain("todos[0].status");
    expect(events).toEqual([]);
  });

  test("refuses several tasks in progress at once", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute(
      { todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] },
      ctx(events),
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("Only one task");
    expect(events).toEqual([]);
  });

  test("an empty list clears the plan", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute({ todos: [] }, ctx(events));
    expect(res.ok).toBe(true);
    expect(events).toEqual([{ type: "plan", entries: [] }]);
    expect(res.output).toBe("List cleared.");
  });
});
