import { describe, expect, it } from "vitest";
import { cardOf, eventsOfUpdate, isServerConfirmedCall, isUngatedMcpCall, matchServedCall, mcpToolOf, mergeCallInfo, permissionSubject, modelsOfConfig, modelsOfSession, effortsOfConfig, pickPermissionOption, toolOutputOf, turnMode, TurnCost, DEFAULT_MODEL, type AgentModes } from "./translate";
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

  it("passes the agent's commands to the composer, and its own mode changes to the picker", () => {
    expect(
      eventsOfUpdate({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "goal", description: "Set a goal", input: { hint: "[objective]" } }] }),
    ).toEqual([{ type: "commands", commands: [{ name: "goal", description: "Set a goal", args: "[objective]" }] }]);
    expect(eventsOfUpdate({ sessionUpdate: "current_mode_update", currentModeId: "acceptEdits" })).toEqual([{ type: "agent_config", mode: "acceptEdits" }]);
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
    expect(modelsOfConfig("copilot", [grouped], []).map((m) => m.id)).toEqual(["acp:copilot/a"]);
  });

  it("reads the old `models` field when there is no model option", () => {
    const models = modelsOfSession("grok", { models: { availableModels: [{ modelId: "auto", name: "Auto" }, { modelId: "grok-5", name: "grok-5" }], currentModelId: "auto" } }, []);
    expect(models.map((m) => m.id)).toEqual(["acp:grok/auto", "acp:grok/grok-5"]);
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
  /* S1: a one-time answer must never be recorded as a permanent one. */
  it("never turns a one-time Allow into allow_always: without allow_once, null (cancelled)", () => {
    const onlyAlways: PermissionOption[] = [
      { optionId: "yes-always", name: "Always allow", kind: "allow_always" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ];
    expect(pickPermissionOption(onlyAlways, true, false)).toBeNull();
    expect(pickPermissionOption(onlyAlways, true, true)).toBe("yes-always");
  });
  it("never turns a one-time Deny into reject_always: without reject_once, null (cancelled)", () => {
    const onlyNever: PermissionOption[] = [
      { optionId: "ok", name: "Allow", kind: "allow_once" },
      { optionId: "never", name: "Never", kind: "reject_always" },
    ];
    expect(pickPermissionOption(onlyNever, false, false)).toBeNull();
    expect(pickPermissionOption(onlyNever, false, true)).toBe("never");
    expect(pickPermissionOption(options, false, true)).toBe("r1");
  });
});

describe("Codex MCP calls (F2)", () => {
  const rawInput = { server: "bytnode-ai", tool: "PositionSize", arguments: { capital: 1000, side: "long" } };
  it("names the call after the MCP tool and keeps only its arguments", () => {
    const u = { sessionUpdate: "tool_call", toolCallId: "exec-1", title: "mcp.bytnode-ai.PositionSize", kind: "execute", status: "in_progress", rawInput, _meta: { is_mcp_tool_call: true } } as SessionUpdate;
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "exec-1", name: "mcp__bytnode-ai__PositionSize", args: { capital: 1000, side: "long" } }]);
    const w = { sessionUpdate: "tool_call", toolCallId: "exec-2", kind: "execute", status: "in_progress", rawInput: { server: "bytnode-ai", tool: "Workflow", arguments: { tasks: [] } } } as unknown as SessionUpdate;
    expect(eventsOfUpdate(w)[0]).toMatchObject({ name: "mcp__bytnode-ai__Workflow", args: { tasks: [] } });
  });
  it("reads the card and the text from the Codex envelope { result: { content }, error }", () => {
    const card = { kind: "facts", data: { title: "Position size" } };
    const rawOutput = {
      result: {
        content: [
          { type: "text", text: "Size: 1.95" },
          { type: "resource", resource: { uri: "bytnode-ai://card", mimeType: "application/json", text: JSON.stringify(card) } },
          { type: "text", text: `bytnode-ai://card ${JSON.stringify(card)}` },
        ],
        structuredContent: null,
        _meta: null,
      },
      error: null,
    };
    const events = eventsOfUpdate({ sessionUpdate: "tool_call_update", toolCallId: "exec-1", status: "completed", rawInput, rawOutput } as SessionUpdate);
    expect(events).toEqual([{ type: "tool_result", id: "exec-1", ok: true, output: "Size: 1.95", card }]);
  });
  it("shows the envelope's error", () => {
    expect(toolOutputOf({ toolCallId: "x", status: "completed", rawOutput: { result: null, error: "tool timed out" } })).toBe("tool timed out");
  });
});

describe("mcpToolOf / isUngatedMcpCall (F4)", () => {
  const ungated = new Set(["PositionSize"]);
  it("finds the MCP tool behind Claude and Codex calls", () => {
    expect(mcpToolOf({ title: "mcp__bytnode-ai__PositionSize" })).toEqual({ server: "bytnode-ai", tool: "PositionSize" });
    expect(mcpToolOf({ title: "Run", _meta: { claudeCode: { toolName: "mcp__bytnode__get_market_data" } } })).toEqual({ server: "bytnode", tool: "get_market_data" });
    expect(mcpToolOf({ title: "Approve", rawInput: { server: "bytnode-ai", tool: "PlaceOrder", arguments: {} } })).toEqual({ server: "bytnode-ai", tool: "PlaceOrder" });
    expect(mcpToolOf({ title: "Bash echo hi" })).toBeNull();
  });
  it("lets through only our ungated tools and the BytNode data server", () => {
    expect(isUngatedMcpCall({ title: "mcp__bytnode-ai__PositionSize" }, ungated)).toBe(true);
    expect(isUngatedMcpCall({ title: "mcp__bytnode-ai__Workflow" }, ungated)).toBe(false);
    expect(isUngatedMcpCall({ title: "mcp__bytnode__get_market_data" }, ungated)).toBe(true);
    expect(isUngatedMcpCall({ title: "mcp__other__PositionSize" }, ungated)).toBe(false);
    expect(isUngatedMcpCall({ title: "Write notes.md" }, ungated)).toBe(false);
  });
});

describe("permissionSubject (Codex asks with an empty title)", () => {
  const known = mergeCallInfo(undefined, { title: "mcp.bytnode-ai.PlaceOrder", rawInput: { server: "bytnode-ai", tool: "PlaceOrder", arguments: {} } });
  it("completes the request with what the call said, and names it", () => {
    const s = permissionSubject({ title: "" }, known);
    expect(mcpToolOf(s.call)).toEqual({ server: "bytnode-ai", tool: "PlaceOrder" });
    expect(s.title).toBe("mcp__bytnode-ai__PlaceOrder");
    expect(s.identified).toBe(true);
  });
  it("keeps the request's own title, and says when nothing identifies the call", () => {
    expect(permissionSubject({ title: "Edit files" }, undefined)).toMatchObject({ title: "Edit files", identified: true });
    expect(permissionSubject({ title: "" }, undefined).identified).toBe(false);
  });
});

describe("turnMode (Codex asks by default, the user's pick wins)", () => {
  const modes: AgentModes = {
    configId: "mode",
    current: "agent",
    options: [
      { value: "read-only", name: "Ask for approval" },
      { value: "agent", name: "Approve for me" },
      { value: "agent-full-access", name: "Full access" },
    ],
  };
  it("with nothing picked, starts in the asking mode", () => {
    expect(turnMode(modes, { requested: null, askMode: "read-only", restore: null })).toBe("read-only");
  });
  it("a mode the user picked wins over the asking default (Full access asks nothing but money)", () => {
    expect(turnMode(modes, { requested: "agent-full-access", askMode: "read-only", restore: null })).toBe("agent-full-access");
    expect(turnMode(modes, { requested: "unknown-mode", askMode: "read-only", restore: null })).toBe("read-only");
  });
  it("in Run directly: the mode picked, else the one before we forced it, else nothing", () => {
    expect(turnMode(modes, { requested: "agent-full-access", askMode: null, restore: "agent" })).toBe("agent-full-access");
    expect(turnMode(modes, { requested: null, askMode: null, restore: "agent" })).toBe("agent");
    expect(turnMode(modes, { requested: null, askMode: null, restore: null })).toBeNull();
    expect(turnMode(null, { requested: "x", askMode: "read-only", restore: null })).toBeNull();
  });
});

describe("TurnCost (the meter shows the turn, not the process total)", () => {
  it("subtracts the total at the start of the turn", () => {
    const c = new TurnCost();
    c.begin();
    expect(c.of(0.0192)).toBeCloseTo(0.0192);
    c.begin();
    expect(c.of(0.0226)).toBeCloseTo(0.0034);
    c.begin();
    expect(c.of(0.03)).toBeCloseTo(0.0074);
    expect(c.of(0.0359)).toBeCloseTo(0.0133);
  });
  it("ignores the 0 of a cancelled turn, and restarts from zero when the counter goes down", () => {
    const c = new TurnCost();
    c.begin();
    c.of(0.05);
    c.begin();
    expect(c.of(0)).toBeNull();
    expect(c.of(0.06)).toBeCloseTo(0.01);
    c.begin();
    expect(c.of(0.004)).toBeCloseTo(0.004);
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
  it("hides the Claude Code rendering of the resource (F1)", () => {
    const card = { kind: "facts", data: { title: "Position size · long" } };
    const text = `Size: 1.9542701 (base asset)\nFees 0.060 % per side.\n[Resource from bytnode-ai at bytnode-ai://card] ${JSON.stringify(card)}`;
    const update = { toolCallId: "t", status: "completed" as const, content: [{ type: "content" as const, content: { type: "text" as const, text } }] };
    expect(toolOutputOf(update)).toBe("Size: 1.9542701 (base asset)\nFees 0.060 % per side.");
    expect(cardOf(update)).toEqual(card);
  });
  it("rides on the result event", () => {
    const events = eventsOfUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: resource as never }] });
    expect(events[0]).toMatchObject({ type: "tool_result", card });
  });
});

describe("isServerConfirmedCall / matchServedCall (money actions confirmed by our server)", () => {
  const money = ["PlaceOrder", "ClosePosition", "Transfer"];
  it("only OUR server's tools that always ask, whatever way the agent names them", () => {
    expect(isServerConfirmedCall({ title: "mcp__bytnode-ai__PlaceOrder" }, money)).toBe(true);
    expect(isServerConfirmedCall({ title: "", rawInput: { server: "bytnode-ai", tool: "Transfer", arguments: {} } }, money)).toBe(true);
    expect(isServerConfirmedCall({ title: "x", _meta: { claudeCode: { toolName: "mcp__bytnode-ai__ClosePosition" } } }, money)).toBe(true);
    /* Another server, the agent's own tool, a title that merely mentions it, a tool of ours that does not always ask. */
    expect(isServerConfirmedCall({ title: "mcp__other__PlaceOrder" }, money)).toBe(false);
    expect(isServerConfirmedCall({ title: "PlaceOrder" }, money)).toBe(false);
    expect(isServerConfirmedCall({ title: "Run PlaceOrder script" }, money)).toBe(false);
    expect(isServerConfirmedCall({ title: "mcp__bytnode-ai__PlaceOrderX" }, money)).toBe(false);
    expect(isServerConfirmedCall({ title: "mcp__bytnode-ai__CancelOrder" }, money)).toBe(false);
  });

  it("finds the agent's call behind the server's: same arguments first, else the latest to that tool", () => {
    const order = (args: unknown) => ({ title: "mcp__bytnode-ai__PlaceOrder", rawInput: args });
    const calls = [
      { id: "a", call: order({ symbol: "BTC/USDT", amount: 1 }) },
      { id: "b", call: order({ amount: 2, symbol: "BTC/USDT" }) },
      { id: "c", call: { title: "", rawInput: { server: "bytnode-ai", tool: "PlaceOrder", arguments: { symbol: "ETH/USDT" } } } },
      { id: "d", call: { title: "mcp__other__PlaceOrder", rawInput: { symbol: "BTC/USDT", amount: 1 } } },
    ];
    expect(matchServedCall(calls, "PlaceOrder", { symbol: "BTC/USDT", amount: 1 })).toBe("a");
    expect(matchServedCall(calls, "PlaceOrder", { symbol: "BTC/USDT", amount: 2 })).toBe("b");
    expect(matchServedCall(calls, "PlaceOrder", { symbol: "ETH/USDT" })).toBe("c");
    expect(matchServedCall(calls, "PlaceOrder", { symbol: "SOL/USDT" })).toBe("c");
    expect(matchServedCall(calls, "Transfer", {})).toBeNull();
    expect(matchServedCall([{ id: "x", call: undefined }], "PlaceOrder", {})).toBeNull();
  });
});
