import { describe, expect, test } from "vitest";
import { pruneToolOutputs, stepsToMessages, type ProviderMessage } from "./history";
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

  test("a compaction in progress is never replayed", () => {
    expect(stepsToMessages({ ...assistant([{ type: "text", text: "1. Demande…" }], "1. Demande…"), compacting: true })).toEqual([]);
  });
});

/* Comme Claude Code ou Codex : quand le fil pese, les vieux resultats
   d'outils sont remplaces par un marqueur, les N plus recents restent
   entiers. Le fil affiche n'est jamais touche — seul le rejeu change. */
describe("pruneToolOutputs", () => {
  const tool = (id: string, content: string): ProviderMessage => ({ role: "tool", tool_call_id: id, content });
  const big = (n: number) => "x".repeat(n);
  const history: ProviderMessage[] = [
    { role: "system", content: "S" },
    { role: "user", content: "Q" },
    { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "Read", arguments: "{}" } }] },
    tool("a", big(1000)),
    tool("b", "court"),
    tool("c", big(1000)),
    { role: "assistant", content: "R" },
    tool("d", big(1000)),
    tool("e", big(1000)),
  ];

  test("garde les derniers resultats entiers et elague les anciens trop longs", () => {
    const out = pruneToolOutputs(history, { keep: 2, head: 100 });
    const byId = (id: string) => out.find((m) => m.role === "tool" && m.tool_call_id === id)!;
    expect(byId("a").content).toBe(`${big(100)}
[… sortie élaguée pour libérer du contexte (900 caractères de plus). Relance l'outil si tu as besoin du détail.]`);
    expect(byId("b").content).toBe("court");
    expect(byId("c").content).toMatch(/élaguée/);
    expect(byId("d").content).toBe(big(1000));
    expect(byId("e").content).toBe(big(1000));
  });

  test("ne touche ni les autres messages ni l'ordre, et ne mute pas l'entree", () => {
    const before = JSON.stringify(history);
    const out = pruneToolOutputs(history, { keep: 0, head: 10 });
    expect(out.map((m) => m.role)).toEqual(history.map((m) => m.role));
    expect(out[0]).toBe(history[0]);
    expect(out[2]).toBe(history[2]);
    expect(JSON.stringify(history)).toBe(before);
  });

  test("keep: 0 elague tout, un fil court reste tel quel", () => {
    expect(pruneToolOutputs(history, { keep: 0, head: 10 }).filter((m) => m.role === "tool" && /élaguée/.test(String(m.content)))).toHaveLength(4);
    expect(pruneToolOutputs(history, { keep: 10, head: 10 })).toEqual(history);
  });
});
