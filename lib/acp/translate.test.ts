import { describe, expect, it } from "vitest";
import { cardOf, eventsOfUpdate, modelsOfConfig, modelsOfSession, effortsOfConfig, pickPermissionOption, toolOutputOf, DEFAULT_MODEL } from "./translate";
import type { SessionConfigOption, SessionUpdate, PermissionOption } from "@agentclientprotocol/sdk";

describe("eventsOfUpdate", () => {
  it("translates a text chunk from the agent", () => {
    const u: SessionUpdate = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("drops the reasoning — chunks and « think » calls — and replayed user messages", () => {
    expect(eventsOfUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } })).toEqual([]);
    expect(
      eventsOfUpdate({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Thinking", kind: "think", status: "in_progress" } as SessionUpdate),
    ).toEqual([]);
    expect(eventsOfUpdate({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } })).toEqual([]);
  });

  it("translates the plan and the usage count", () => {
    expect(
      eventsOfUpdate({
        sessionUpdate: "plan",
        entries: [
          { content: "read the data", status: "completed", priority: "high" },
          { content: "backtest", status: "pending", priority: "medium" },
        ],
      }),
    ).toEqual([
      {
        type: "plan",
        entries: [
          { content: "read the data", status: "completed" },
          { content: "backtest", status: "pending" },
        ],
      },
    ]);
    expect(eventsOfUpdate({ sessionUpdate: "usage_update", used: 33_502, size: 1_000_000, cost: { amount: 0.2487, currency: "USD" } })).toEqual([
      { type: "usage", usage: { context: 33_502, window: 1_000_000, cost: 0.2487 } },
    ]);
  });

  it("opens a tool call with its title and raw arguments", () => {
    const u: SessionUpdate = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "Read src/index.ts",
      name: "Read",
      kind: "read",
      status: "pending",
      rawInput: { file_path: "src/index.ts" },
    };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c1", name: "Read", args: { file_path: "src/index.ts" } }]);
  });

  it("names the call by its category when the agent gives no name, and keeps the title", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call", toolCallId: "c2", title: "ls -la", kind: "execute", status: "in_progress" };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c2", name: "Command", args: { title: "ls -la" } }]);
  });

  it("closes a finished call with its text output", () => {
    const u: SessionUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "const a = 1;" } }],
    };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_result", id: "c1", ok: true, output: "const a = 1;" }]);
  });

  it("closes a failed call", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", rawOutput: "boom" };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_result", id: "c1", ok: false, output: "boom" }]);
  });

  it("closes nothing while the call is in progress, but passes on the refined arguments", () => {
    expect(eventsOfUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" })).toEqual([]);
    const u: SessionUpdate = { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "Find `*`", rawInput: { pattern: "*" }, _meta: { claudeCode: { toolName: "Glob" } } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_update", id: "c1", name: "Glob", args: { pattern: "*" } }]);
  });

  it("takes the tool name Claude Code slips into the metadata", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call", toolCallId: "c3", title: "Find `*`", kind: "search", status: "pending", rawInput: {}, _meta: { claudeCode: { toolName: "Glob" } } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c3", name: "Glob", args: { title: "Find `*`" } }]);
  });
});

describe("toolOutputOf", () => {
  it("summarises a diff by its path", () => {
    const out = toolOutputOf({
      toolCallId: "c",
      content: [{ type: "diff", path: "C:/w/a.ts", oldText: "a", newText: "b" }],
    });
    expect(out).toContain("C:/w/a.ts");
    expect(out).toContain("b");
  });

  it("for a failure, prefers the raw error to the diff", () => {
    const out = toolOutputOf({ toolCallId: "c", status: "failed", rawOutput: "InputValidationError", content: [{ type: "diff", path: "a.txt", newText: "ok" }] });
    expect(out).toBe("InputValidationError");
  });

  it("without content, takes the raw output", () => {
    expect(toolOutputOf({ toolCallId: "c", rawOutput: { ok: true } })).toBe('{"ok":true}');
  });
});

describe("modelsOfConfig", () => {
  const options: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "sonnet",
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet", description: "Fast" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ];

  it("prefixes the ids and keeps the agent's order as recency order", () => {
    const models = modelsOfConfig("openai", options, []);
    expect(models.map((m) => m.id)).toEqual(["acp:openai/opus", "acp:openai/sonnet"]);
    expect(models[0].created).toBeGreaterThan(models[1].created);
    expect(models[0].providerId).toBe("acp:openai");
    expect(models[0].variant).toBeNull();
  });

  it("carries the efforts the agent publishes, and the current effort as default", () => {
    const models = modelsOfConfig("openai", options, []);
    expect(models[0].efforts).toEqual(["low", "medium", "high"]);
    expect(models[0].defaultEffort).toBe("medium");
    expect(models[0].reasoningMandatory).toBe(true);
  });

  it("falls back to the fixed efforts when the agent publishes none", () => {
    const models = modelsOfConfig("claude", [options[0]], ["max", "high"]);
    expect(models[0].efforts).toEqual(["max", "high"]);
    expect(models[0].defaultEffort).toBeNull();
  });

  it("flattens option groups", () => {
    const grouped: SessionConfigOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "a",
      options: [{ group: "g", name: "G", options: [{ value: "a", name: "A" }] }],
    };
    expect(modelsOfConfig("gemini", [grouped], []).map((m) => m.id)).toEqual(["acp:gemini/a"]);
  });

  it("reads the old `models` field (Gemini CLI) when there is no model option", () => {
    const models = modelsOfSession("gemini", { models: { availableModels: [{ modelId: "auto", name: "Auto" }, { modelId: "gemini-2.5-pro", name: "gemini-2.5-pro" }], currentModelId: "auto" } }, []);
    expect(models.map((m) => m.id)).toEqual(["acp:gemini/auto", "acp:gemini/gemini-2.5-pro"]);
  });

  it("with no model published at all, offers « Default »", () => {
    const models = modelsOfSession("copilot", { configOptions: [{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }] }] }, []);
    expect(models.map((m) => m.id)).toEqual([`acp:copilot/${DEFAULT_MODEL}`]);
    expect(models[0].name).toBe("Default");
  });

  it("effortsOfConfig returns the effort option and its value", () => {
    expect(effortsOfConfig(options)).toEqual({ configId: "reasoning_effort", values: ["low", "medium", "high"], current: "medium" });
    expect(effortsOfConfig([options[0]])).toBeNull();
  });
});

describe("pickPermissionOption", () => {
  const options: PermissionOption[] = [
    { optionId: "a1", name: "Allow", kind: "allow_once" },
    { optionId: "aa", name: "Always", kind: "allow_always" },
    { optionId: "r1", name: "Reject", kind: "reject_once" },
  ];
  it("allows once, or always when asked and available", () => {
    expect(pickPermissionOption(options, true, false)).toBe("a1");
    expect(pickPermissionOption(options, true, true)).toBe("aa");
    expect(pickPermissionOption(options.filter((o) => o.kind !== "allow_always"), true, true)).toBe("a1");
  });
  it("rejects", () => {
    expect(pickPermissionOption(options, false, false)).toBe("r1");
  });
  it("without a reject option, returns null", () => {
    expect(pickPermissionOption(options.slice(0, 2), false, false)).toBeNull();
  });
});

describe("cardOf", () => {
  const card = { kind: "position-size", data: { size: 0.05 } };
  const resource = { type: "resource", resource: { uri: "bytnode-ai://card", mimeType: "application/json", text: JSON.stringify(card) } };
  it("finds our card in the contents or in the raw output", () => {
    expect(cardOf({ content: [{ type: "content", content: resource as never }] })).toEqual(card);
    expect(cardOf({ rawOutput: [{ type: "text", text: "ok" }, resource] })).toEqual(card);
    expect(cardOf({ rawOutput: { content: [resource] } })).toEqual(card);
  });
  it("ignores anything else", () => {
    expect(cardOf({ rawOutput: [{ type: "resource", resource: { uri: "file:///x", text: "{}" } }] })).toBeUndefined();
    expect(cardOf({ rawOutput: [{ type: "resource", resource: { uri: "bytnode-ai://card", text: "not json" } }] })).toBeUndefined();
    expect(cardOf({})).toBeUndefined();
  });

  it("finds it when the agent turned the resource into text (Claude Code), or on the marker line", () => {
    const card = { kind: "plugin-review", data: { pluginId: "u-journal", name: "Journal", digest: "abc" } };
    const resource = { type: "resource", resource: { uri: "bytnode-ai://card", mimeType: "application/json", text: JSON.stringify(card) } };
    /* Claude Code's adapter: an unknown block becomes its JSON, as text. */
    expect(cardOf({ content: [{ type: "content", content: { type: "text", text: JSON.stringify(resource) } }] })).toEqual(card);
    /* The marker line the MCP server adds. */
    expect(cardOf({ content: [{ type: "content", content: { type: "text", text: `bytnode-ai://card ${JSON.stringify(card)}` } }] })).toEqual(card);
    expect(cardOf({ rawOutput: `Done.\nbytnode-ai://card ${JSON.stringify(card)}` })).toEqual(card);
    /* The carrier never shows as the output. */
    const update = { toolCallId: "t", status: "completed" as const, content: [{ type: "content" as const, content: { type: "text" as const, text: "Activated." } }, { type: "content" as const, content: { type: "text" as const, text: JSON.stringify(resource) } }, { type: "content" as const, content: { type: "text" as const, text: `bytnode-ai://card ${JSON.stringify(card)}` } }] };
    expect(toolOutputOf(update)).toBe("Activated.");
  });
  it("rides on the result event", () => {
    const events = eventsOfUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: resource as never }] });
    expect(events[0]).toMatchObject({ type: "tool_result", card });
  });
});
