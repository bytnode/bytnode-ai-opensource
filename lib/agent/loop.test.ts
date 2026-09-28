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

  test("image attachments are pushed to the model by default", async () => {
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c", name: "Glob", args: "{}" }], finish: "tool_calls" }],
      [{ text: "fait", finish: "stop" }],
    ]);
    const seen: unknown[] = [];
    await runAgentLoop([{ role: "user", content: "x" }], {
      complete: (m) => {
        seen.push(m);
        return complete();
      },
      execute: async () => ({ ok: true, output: "chart at out/charts/a.png", attachments: [{ type: "image", name: "out/charts/a.png", dataUrl: "data:image/png;base64,AAAA" }] }),
      emit: () => {},
      tools,
      signal: new AbortController().signal,
    });
    const second = seen[1] as Array<{ role: string; content: unknown }>;
    const image = second.find((m) => m.role === "user" && Array.isArray(m.content));
    expect(image).toBeDefined();
    expect(JSON.stringify(image?.content)).toContain("data:image/png;base64");
  });

  test("a text-only model (sub-agent, background) is never sent an image", async () => {
    const complete = scripted([
      [{ text: "", toolCalls: [{ index: 0, id: "c", name: "Glob", args: "{}" }], finish: "tool_calls" }],
      [{ text: "fait", finish: "stop" }],
    ]);
    const seen: unknown[] = [];
    await runAgentLoop([{ role: "user", content: "x" }], {
      complete: (m) => {
        seen.push(m);
        return complete();
      },
      execute: async () => ({ ok: true, output: "chart at out/charts/a.png", attachments: [{ type: "image", name: "out/charts/a.png", dataUrl: "data:image/png;base64,AAAA" }] }),
      emit: () => {},
      tools,
      modelSeesImages: false,
      signal: new AbortController().signal,
    });
    /* Every message after the tool run must be text-only: no image_url ever
       reaches a model that would reject it. */
    const second = seen[1] as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(second)).not.toContain("data:image/png;base64");
    expect(second.filter((m) => m.role === "tool")[0]?.content).toBe("chart at out/charts/a.png");
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

/* A text-only model refuses any history holding an image: the turn is
   replayed once with the images replaced by a note, instead of failing. */
describe("runAgentLoop: a model that does not read images", () => {
  test("images are replaced by a note and the turn is replayed", async () => {
    const sent: unknown[] = [];
    let calls = 0;
    const deps: LoopDeps = {
      complete: (messages) => {
        calls++;
        sent.push(JSON.stringify(messages));
        const refuse = calls === 1;
        return (async function* () {
          if (refuse) throw new Error("No endpoints found that support image input");
          yield { text: "Read it as text." } as Delta;
          yield { text: "", finish: "stop" } as Delta;
        })();
      },
      execute: async () => ({ ok: true, output: "" }),
      emit: () => {},
      tools,
      signal: new AbortController().signal,
    };
    const history = [{ role: "user" as const, content: [{ type: "text" as const, text: "Look" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }] }];
    const out = await runAgentLoop(history, deps);
    expect(out.text).toBe("Read it as text.");
    expect(calls).toBe(2);
    expect(sent[1]).not.toContain("image_url");
    expect(sent[1]).toContain("image not shown");
  });

  test("without any image, the refusal is not swallowed", async () => {
    const deps: LoopDeps = {
      complete: () =>
        (async function* () {
          throw new Error("No endpoints found that support image input");
        })(),
      execute: async () => ({ ok: true, output: "" }),
      emit: () => {},
      tools,
      signal: new AbortController().signal,
    };
    await expect(runAgentLoop([{ role: "user", content: "hi" }], deps)).rejects.toThrow(/image input/);
  });
});
