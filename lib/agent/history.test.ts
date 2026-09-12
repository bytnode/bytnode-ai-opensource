import { describe, expect, test } from "vitest";
import { stepsToMessages } from "./history";
import type { Message } from "@/lib/domain/types";

const assistant = (steps: Message["steps"], content = ""): Message => ({ id: "m", role: "assistant", content, createdAt: 0, steps });

describe("stepsToMessages", () => {
  test("a plain assistant message is one message", () => {
    expect(stepsToMessages({ id: "m", role: "assistant", content: "Salut", createdAt: 0 })).toEqual([{ role: "assistant", content: "Salut" }]);
  });

  test("text, tool calls and results are replayed in provider order", () => {
    const out = stepsToMessages(
      assistant([
        { type: "text", text: "Je regarde." },
        { type: "tool", id: "c1", name: "Read", args: { file_path: "a" }, status: "done", output: "1\tx" },
        { type: "tool", id: "c2", name: "Glob", args: { pattern: "*" }, status: "failed", output: "boom" },
        { type: "text", text: "Voilà." },
      ]),
    );
    expect(out).toEqual([
      {
        role: "assistant",
        content: "Je regarde.",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "Read", arguments: '{"file_path":"a"}' } },
          { id: "c2", type: "function", function: { name: "Glob", arguments: '{"pattern":"*"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "1\tx" },
      { role: "tool", tool_call_id: "c2", content: "boom" },
      { role: "assistant", content: "Voilà." },
    ]);
  });

  test("a tool still running when the turn ended is replayed as interrupted", () => {
    const out = stepsToMessages(assistant([{ type: "tool", id: "c1", name: "Bash", args: {}, status: "running" }]));
    expect(out[1]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(String(out[1].content)).toMatch(/interrompu/i);
  });
});
