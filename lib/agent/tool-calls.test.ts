import { describe, expect, test } from "vitest";
import { ToolCallAccumulator } from "./tool-calls";
import { extractDelta } from "@/lib/llm/sse";

describe("extractDelta with tool calls", () => {
  test("surfaces tool_call fragments and the finish reason", () => {
    const d = extractDelta('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"Read","arguments":"{\\"fi"}}]},"finish_reason":null}]}');
    expect(d.toolCalls).toEqual([{ index: 0, id: "c1", name: "Read", args: '{"fi' }]);
    const end = extractDelta('{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}');
    expect(end.finish).toBe("tool_calls");
  });
});

describe("ToolCallAccumulator", () => {
  test("stitches fragments by index into complete calls with parsed arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: "c1", name: "Read", args: '{"file_' }]);
    acc.add([{ index: 0, args: 'path":"a.ts"}' }]);
    acc.add([{ index: 1, id: "c2", name: "Glob", args: '{"pattern":"*.md"}' }]);
    expect(acc.calls()).toMatchObject([
      { id: "c1", name: "Read", args: { file_path: "a.ts" } },
      { id: "c2", name: "Glob", args: { pattern: "*.md" } },
    ]);
  });

  test("gives an empty object for empty or broken arguments, keeping the raw text", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, id: "c1", name: "Glob", args: "" }]);
    acc.add([{ index: 1, id: "c2", name: "Read", args: "{broken" }]);
    const [a, b] = acc.calls();
    expect(a.args).toEqual({});
    expect(b.args).toEqual({});
    expect(b.rawArgs).toBe("{broken");
  });

  test("invents an id when the provider sends none", () => {
    const acc = new ToolCallAccumulator();
    acc.add([{ index: 0, name: "Glob", args: "{}" }]);
    expect(acc.calls()[0].id).toMatch(/^call_/);
  });
});
