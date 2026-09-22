import { describe, expect, it } from "vitest";
import { professionInfo } from "@/lib/professions/catalog";
import { validateArgs } from "../validate";
import {
  CONCURRENCY,
  MAX_TASKS,
  failureBody,
  parseWorkflowReport,
  readTasks,
  reportSection,
  runInPool,
  subagentFrame,
  subagentMessage,
  workflowDescription,
  workflowParameters,
  type SubagentTask,
} from "./subagent";

const task = (over: Partial<SubagentTask> = {}): SubagentTask => ({ title: "Read the funding", prompt: "Look at the BTC funding.", profession: "analyste", ...over });

describe("workflowParameters", () => {
  it("requires a title, one of the four professions and a prompt", () => {
    const schema = workflowParameters({ kind: "openrouter" });
    expect(validateArgs(schema, { tasks: [task()] })).toBeNull();
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y" }] })).toMatch(/profession/);
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y", profession: "trader" }] })).toMatch(/not in list/);
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y", profession: "quantitatif" }] })).toBeNull();
  });

  it("bounds the model to the agent's list when it is known", () => {
    const schema = workflowParameters({ kind: "list", ids: ["haiku", "opus"] });
    expect(validateArgs(schema, { tasks: [task({ model: "opus" })] })).toBeNull();
    expect(validateArgs(schema, { tasks: [task({ model: "gpt-5" })] })).toMatch(/model/);
    /* Neither a list nor OpenRouter: free. */
    expect(validateArgs(workflowParameters({ kind: "list", ids: [] }), { tasks: [task({ model: "anything" })] })).toBeNull();
    expect(validateArgs(workflowParameters({ kind: "openrouter" }), { tasks: [task({ model: "openai/gpt-5-mini" })] })).toBeNull();
  });
});

describe("workflowDescription", () => {
  it("names the four professions and the model rule", () => {
    const d = workflowDescription({ kind: "openrouter" });
    for (const id of ["standard", "analyste", "strategique", "quantitatif"]) expect(d).toContain(id);
    expect(d).toContain("OpenRouter");
    expect(d).toContain("difficulty");
    expect(workflowDescription({ kind: "list", ids: ["haiku", "opus"] })).toContain("among: haiku, opus");
    expect(workflowDescription({ kind: "list", ids: [] })).toContain("one of your agent's models");
  });
});

describe("readTasks", () => {
  it("keeps the tasks in order, at their index, with a default title", () => {
    const out = readTasks([
      { title: "  A  ", prompt: "p1", profession: "standard", model: " haiku " },
      { prompt: "p2", profession: "quantitatif" },
    ]);
    expect(out).toEqual({
      tasks: [
        { title: "A", prompt: "p1", profession: "standard", model: "haiku" },
        { title: "Task 2", prompt: "p2", profession: "quantitatif" },
      ],
    });
  });

  it("refuses the whole call as soon as one task is incomplete — the thread's indexes stay right", () => {
    expect(readTasks([{ title: "ok", prompt: "p", profession: "analyste" }, { title: "no prompt", profession: "analyste" }])).toEqual({ error: "Task 2 has no prompt." });
    expect(readTasks([{ title: "x", prompt: "p", profession: "trader" }])).toMatchObject({ error: expect.stringContaining("Task 1") });
    expect(readTasks([null])).toMatchObject({ error: expect.stringContaining("profession") });
    expect(readTasks(undefined)).toMatchObject({ error: expect.stringContaining("at least one task") });
    expect(readTasks([])).toMatchObject({ error: expect.stringContaining("at least one task") });
  });

  it("bounds to MAX_TASKS", () => {
    const many = Array.from({ length: MAX_TASKS + 3 }, (_, i) => ({ title: `t${i}`, prompt: "p", profession: "standard" }));
    const out = readTasks(many);
    expect("tasks" in out && out.tasks).toHaveLength(MAX_TASKS);
  });
});

describe("runInPool", () => {
  it("runs CONCURRENCY tasks at a time and returns the results at their task's index", async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task({ title: `t${i}` }));
    let running = 0;
    let peak = 0;
    const out = await runInPool(tasks, async (t, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, i % 2 ? 2 : 6));
      running--;
      return `${i}:${t.title}`;
    });
    expect(peak).toBe(CONCURRENCY);
    expect(out).toEqual(tasks.map((t, i) => `${i}:${t.title}`));
  });
});

describe("subagentFrame / subagentMessage", () => {
  it("states the profession, the workspace, the profession prompt and the prohibitions", () => {
    const s = subagentFrame("quantitatif", "## Profession: quant\n\nYou write code.", "C:\\ws");
    expect(s).toContain(`${professionInfo("quantitatif").label} sub-agent`);
    expect(s).toContain("`C:\\ws`");
    expect(s).toContain("You write code.");
    expect(s).toMatch(/no sub-agents/);
    expect(s).toMatch(/no order/);
    expect(s).toContain("report");
  });

  it("puts the shared context before the task", () => {
    expect(subagentMessage(task(), "  Context: BTC.  ")).toBe("Context: BTC.\n\nLook at the BTC funding.");
    expect(subagentMessage(task(), "   ")).toBe("Look at the BTC funding.");
    expect(subagentMessage(task())).toBe("Look at the BTC funding.");
  });
});

describe("reportSection / parseWorkflowReport", () => {
  it("splits back what reportSection assembled, profession included", () => {
    const out = [
      reportSection(task(), "The funding is **positive**.\n\n## Detail\n\n- 0.01 %"),
      reportSection(task({ title: "Quick\nbacktest", profession: "quantitatif" }), failureBody("Python missing")),
      reportSection(task({ title: "Empty", profession: "strategique" }), "   "),
    ].join("\n\n");
    expect(parseWorkflowReport(out)).toEqual([
      { title: "Read the funding", profession: "analyste", body: "The funding is **positive**.\n\n## Detail\n\n- 0.01 %", failed: false },
      { title: "Quick backtest", profession: "quantitatif", body: "[failed: Python missing]", failed: true },
      { title: "Empty", profession: "strategique", body: "(empty report)", failed: false },
    ]);
  });

  it("ignores what precedes the first heading, and an output without a heading", () => {
    expect(parseWorkflowReport("Give at least one task.")).toEqual([]);
    expect(parseWorkflowReport(`noise\n## A — ${professionInfo("standard").label}\n\nbody`)).toEqual([{ title: "A", profession: "standard", body: "body", failed: false }]);
  });
});
