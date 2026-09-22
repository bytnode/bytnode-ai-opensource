import { describe, expect, test } from "vitest";
import { runAgentLoop, type LoopDeps } from "./loop";
import type { Delta } from "@/lib/llm/sse";
import type { AgentEvent } from "./events";

/* A fake model: on the first turn it calls Glob, on the second it concludes. */
const scripted = (turns: Delta[][]) => {
  let i = 0;
  return async function* () {
    for (const d of turns[Math.min(i, turns.length - 1)]) yield d;
    i++;
  };
};

const tools = [{ type: "function" as const, function: { name: "Glob", description: "", parameters: {} } }];

describe("runAgentLoop", () => {
  test("executes tool calls, feeds results back, and returns the final text", async () => {
    const events: AgentEvent[] = [];
    const seen: unknown[] = [];
    const complete = scripted([
      [{ text: "Je cherche. ", toolCalls: [{ index: 0, id: "c1", name: "Glob", args: '{"pattern":"*.md"}' }] }, { text: "", finish: "tool_calls" }],
      [{ text: "Deux fichiers." }, { text: "", finish: "stop" }],
    ]);
    const deps: LoopDeps = {
      complete: (messages) => {
        seen.push(messages.map((m) => m.role));
        return complete();
      },
      execute: async (call) => ({ ok: true, output: `result for ${call.args.pattern}` }),
      emit: (e) => events.push(e),
      tools,
      signal: new AbortController().signal,
    };
    const out = await runAgentLoop([{ role: "user", content: "Liste les md" }], deps);
    expect(out.text).toBe("Je cherche. Deux fichiers.");
    expect(out.turns).toBe(2);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_call", "tool_result", "text", "done"]);
    /* The second turn sees the call and its result. */
    expect(seen[1]).toEqual(["user", "assistant", "tool"]);
  });

  test("a refused permission is reported to the model instead of running the tool", async () => {
    let ran = false;
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c1", name: "Glob", args: "{}" }], finish: "tool_calls" }],
      [{ text: "Bon.", finish: "stop" }],
    ]);
    const events: AgentEvent[] = [];
    await runAgentLoop([{ role: "user", content: "x" }], {
      complete: () => complete(),
      execute: async () => {
        ran = true;
        return { ok: true, output: "" };
      },
      permission: async () => false,
      gated: () => true,
      emit: (e) => events.push(e),
      tools,
      signal: new AbortController().signal,
    });
    expect(ran).toBe(false);
    const res = events.find((e) => e.type === "tool_result");
    expect(res && res.type === "tool_result" && res.ok).toBe(false);
  });

  test("drops the tools on the last allowed turn so the model must conclude", async () => {
    const toolsSeen: Array<number | undefined> = [];
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c", name: "Glob", args: "{}" }], finish: "tool_calls" }],
    ]);
    const out = await runAgentLoop([{ role: "user", content: "x" }], {
      complete: (_m, t) => {
        toolsSeen.push(t?.length);
        if (toolsSeen.length === 3) return (async function* () { yield { text: "fin", finish: "stop" }; })();
        return complete();
      },
      execute: async () => ({ ok: true, output: "" }),
      emit: () => {},
      tools,
      maxTurns: 3,
      signal: new AbortController().signal,
    });
    expect(toolsSeen).toEqual([1, 1, undefined]);
    expect(out.text).toBe("fin");
  });

  test("an ill-formed call is refused before permission and execution, with the reason", async () => {
    let ran = false;
    let asked = false;
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c1", name: "Read", args: '{"limit":"dix"}' }], finish: "tool_calls" }],
      [{ text: "Je corrige.", finish: "stop" }],
    ]);
    const events: AgentEvent[] = [];
    await runAgentLoop([{ role: "user", content: "x" }], {
      complete: () => complete(),
      execute: async () => {
        ran = true;
        return { ok: true, output: "" };
      },
      permission: async () => {
        asked = true;
        return true;
      },
      gated: () => true,
      emit: (e) => events.push(e),
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "",
            parameters: { type: "object", properties: { file_path: { type: "string" }, limit: { type: "integer" } }, required: ["file_path"] },
          },
        },
      ],
      signal: new AbortController().signal,
    });
    expect(ran).toBe(false);
    expect(asked).toBe(false);
    const res = events.find((e) => e.type === "tool_result");
    expect(res && res.type === "tool_result" && !res.ok && res.output).toBe("Invalid arguments for Read: `file_path` required (string). Fix the call.");
  });
});

describe("runAgentLoop: guard rails", () => {
  test("unreadable JSON arguments go back to the model as such, without execution", async () => {
    let ran = false;
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c1", name: "Glob", args: '{"pattern": ' }], finish: "tool_calls" }],
      [{ text: "Ok.", finish: "stop" }],
    ]);
    const events: AgentEvent[] = [];
    await runAgentLoop([{ role: "user", content: "x" }], {
      complete: () => complete(),
      execute: async () => {
        ran = true;
        return { ok: true, output: "" };
      },
      emit: (e) => events.push(e),
      tools: [{ type: "function", function: { name: "Glob", description: "", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } }],
      signal: new AbortController().signal,
    });
    expect(ran).toBe(false);
    const result = events.find((e) => e.type === "tool_result") as { ok: boolean; output: string };
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/JSON/);
    expect(result.output).not.toMatch(/required/);
  });

  test("the last turn does not run tools again, even if the model asks for some", async () => {
    let executions = 0;
    const complete = scripted([[{ text: "encore", toolCalls: [{ index: 0, id: "c", name: "Glob", args: "{}" }], finish: "tool_calls" }]]);
    const out = await runAgentLoop([{ role: "user", content: "x" }], {
      complete: () => complete(),
      execute: async () => {
        executions++;
        return { ok: true, output: "r" };
      },
      emit: () => {},
      tools,
      maxTurns: 2,
      signal: new AbortController().signal,
    });
    expect(out.turns).toBe(2);
    expect(executions).toBe(1);
    expect(out.finishReason).toBe("max_turns");
  });
});
