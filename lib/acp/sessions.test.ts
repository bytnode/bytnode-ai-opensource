import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServer, RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireEvent } from "./wire";

/* The turn bookkeeping of `sessions.ts` against a fake agent: opening
   takes a while (a real one: 5-50 s), prompts are scripted per test. */

process.env.BYTNODE_AI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "acp-sessions-"));
/* The `[acp] …` timings of the dev terminal. */
vi.spyOn(console, "info").mockImplementation(() => {});

type Perm = (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
type Update = (n: SessionNotification) => void;

const log: string[] = [];
/** The whole text of every prompt sent. */
const sent: string[] = [];
const script: {
  openDelay: number;
  onPrompt: (c: FakeConnT, id: string, text: string) => Promise<{ stopReason: string }>;
  onNewSession: (servers: McpServer[]) => void;
  /** What the session published as its commands (`commandsOf`). */
  commands: Array<{ name: string; description: string; trigger?: "/" | "$" }> | null;
  /** What Claude Code's transcript holds for a local command. */
  localOutputs: string[];
  /** `/goal`'s verdict in the transcript. */
  goal: string | null;
} = { openDelay: 0, onPrompt: async () => ({ stopReason: "end_turn" }), onNewSession: () => {}, commands: null, localOutputs: [], goal: null };
const conns: FakeConnT[] = [];

type FakeConnT = {
  agent: string;
  alive: boolean;
  updates: Map<string, Update>;
  perms: Map<string, Perm>;
  cancelled: (() => void) | null;
};

const MODES = {
  openai: { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "agent", options: [{ value: "read-only", name: "Ask" }, { value: "agent", name: "Approve for me" }] },
  claude: { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: "plan", name: "Plan" }] },
} as const;

vi.mock("./prepare", () => ({ prepareWorkspace: async () => {} }));
/* Claude Code's transcript, as the tests script it (never the user's real
   `~/.claude`). */
vi.mock("./claude-transcript", async (original) => ({
  ...(await original<typeof import("./claude-transcript")>()),
  claudeLocalOutputs: async () => script.localOutputs,
  recentTranscripts: () => script.localOutputs.map((text) => JSON.stringify({ type: "system", subtype: "local_command", content: `<local-command-stdout>${text}</local-command-stdout>`, timestamp: new Date(Date.now() + 60_000).toISOString() })),
  claudeGoalVerdict: () => script.goal,
}));
vi.mock("@/lib/mcp/bytnode", () => ({ BYTNODE_MCP_URL: "http://bytnode.test/mcp", bytnodeTools: async () => [] }));
vi.mock("@/lib/plugins/user/files", () => ({ userPluginsVersion: () => "0", verifiedGrantSigs: () => ({}) }));
vi.mock("@/lib/plugins/extras", () => ({ pluginPrompt: async () => "" }));
vi.mock("@/lib/tools/registry", () => ({
  allTools: async () => ({
    tools: [
      { name: "PositionSize", policy: { readOnly: true } },
      { name: "WatchlistEdit", policy: { gated: true } },
      { name: "PlaceOrder", policy: {} },
    ],
    bytnode: { ok: false, count: 0 },
  }),
}));
vi.mock("./connection", () => {
  class FakeConn {
    alive = true;
    capabilities = { loadSession: true, sessionCapabilities: { close: {}, resume: {} } };
    lastStderr = "";
    updates = new Map<string, Update>();
    perms = new Map<string, Perm>();
    cancelled: (() => void) | null = null;
    sessions = 0;
    constructor(readonly agent: string) {}
    static async open(agent: string) {
      await new Promise((r) => setTimeout(r, script.openDelay));
      log.push("open");
      const c = new FakeConn(agent);
      conns.push(c);
      return c;
    }
    get canRestartSession() {
      return true;
    }
    async newSession(_cwd: string, servers: McpServer[]) {
      log.push("newSession");
      script.onNewSession(servers);
      return { sessionId: `s${++this.sessions}`, configOptions: [MODES[this.agent as keyof typeof MODES]] };
    }
    async loadSession(id: string) {
      log.push(`loadSession ${id}`);
      return { configOptions: [MODES[this.agent as keyof typeof MODES]] };
    }
    async setConfig(_s: string, id: string, value: string) {
      log.push(`setConfig ${id}=${value}`);
      return { configOptions: [] };
    }
    async setMode() {}
    async setModel() {}
    listen(id: string, u: Update | null, p: Perm | null) {
      if (u) this.updates.set(id, u);
      else this.updates.delete(id);
      if (p) this.perms.set(id, p);
      else this.perms.delete(id);
    }
    async prompt(id: string, text: string) {
      log.push(`prompt ${text.slice(-12)}`);
      sent.push(text);
      return script.onPrompt(this, id, text);
    }
    commandsOf() {
      return script.commands;
    }
    async cancel() {
      log.push("cancel");
      this.cancelled?.();
    }
    async closeSession(id: string) {
      log.push(`closeSession ${id}`);
    }
    async resumeSession(id: string) {
      log.push(`resumeSession ${id}`);
      return { configOptions: [MODES[this.agent as keyof typeof MODES]] };
    }
    close() {
      log.push("close");
      this.alive = false;
    }
  }
  return { AcpConnection: FakeConn, runningProcesses: () => 0, onAgentIdle: () => {}, knownCommands: () => null };
});

const sessions = await import("./sessions");
const { runTurn, cancelTurn, answerPermission, markToolsReady, closeConversation } = sessions;

let n = 0;
const input = (over: Partial<Parameters<typeof runTurn>[0]> = {}): Parameters<typeof runTurn>[0] => ({
  conversationId: `conv-${n}`,
  agent: "claude",
  agentId: "a1",
  workspace: process.env.BYTNODE_AI_HOME!,
  origin: "http://127.0.0.1:3777",
  bytnodeKey: "",
  exchangeAccounts: [],
  plugins: null,
  system: "sys",
  text: "hello",
  modelId: null,
  effort: null,
  mode: null,
  permissionMode: "ask",
  sessionId: null,
  firstTurn: true,
  ...over,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prompts = () => log.filter((l) => l.startsWith("prompt"));

/** A prompt that waits until cancelled (or `release`d). */
function blockingPrompt() {
  let release = () => {};
  script.onPrompt = (c) =>
    new Promise((resolve) => {
      c.cancelled = () => resolve({ stopReason: "cancelled" });
      release = () => resolve({ stopReason: "end_turn" });
    });
  return () => release();
}

beforeEach(() => {
  n++;
  log.length = 0;
  sent.length = 0;
  conns.length = 0;
  script.openDelay = 0;
  script.onPrompt = async () => ({ stopReason: "end_turn" });
  script.onNewSession = () => {};
  script.commands = null;
  script.localOutputs = [];
  script.goal = null;
});

describe("a Stop or a cancel while the session opens (F7 / A3, F8)", () => {
  it("an aborted request never sends the prompt, and the conversation is free again", async () => {
    script.openDelay = 150;
    const ac = new AbortController();
    const events: WireEvent[] = [];
    const turn = runTurn(input(), (e) => events.push(e), ac.signal);
    await sleep(30);
    ac.abort();
    await turn;
    expect(prompts()).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "cancelled" });
    /* The next message goes through, on the session already open. */
    await runTurn(input({ firstTurn: false }), () => {}, new AbortController().signal);
    expect(prompts()).toHaveLength(1);
    expect(log.filter((l) => l === "open")).toHaveLength(1);
  });

  it("an already-aborted signal counts too", async () => {
    const ac = new AbortController();
    ac.abort();
    await runTurn(input(), () => {}, ac.signal);
    expect(prompts()).toEqual([]);
  });

  it("/api/acp/cancel during the opening is honoured once the session is there", async () => {
    script.openDelay = 150;
    const events: WireEvent[] = [];
    const turn = runTurn(input(), (e) => events.push(e), new AbortController().signal);
    await sleep(30);
    cancelTurn(`conv-${n}`);
    await turn;
    expect(prompts()).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "cancelled" });
  });

  it("a conversation deleted while it opens closes the new session", async () => {
    script.openDelay = 150;
    const turn = runTurn(input(), () => {}, new AbortController().signal);
    await sleep(30);
    closeConversation(`conv-${n}`);
    await turn;
    expect(prompts()).toEqual([]);
    expect(log).toContain("close");
  });
});

describe("one turn at a time (F9, F10)", () => {
  it("two prompts at once on a new conversation: one session, the second refused", async () => {
    script.openDelay = 100;
    const a = runTurn(input(), () => {}, new AbortController().signal);
    await expect(runTurn(input(), () => {}, new AbortController().signal)).rejects.toThrow(/already has a turn in progress/);
    await a;
    expect(log.filter((l) => l === "open")).toHaveLength(1);
  });

  it("a prompt to a busy conversation whose session key changed is refused, and the running turn survives", async () => {
    const release = blockingPrompt();
    const a = runTurn(input(), () => {}, new AbortController().signal);
    await sleep(30);
    await expect(runTurn(input({ system: "another profession", firstTurn: false }), () => {}, new AbortController().signal)).rejects.toThrow(/already has a turn/);
    expect(log).not.toContain("close");
    release();
    await a;
  });

  it("a turn whose connection died forgets only its own session", async () => {
    script.onPrompt = async (c) => {
      c.alive = false;
      throw new Error("ACP connection closed");
    };
    await expect(runTurn(input(), () => {}, new AbortController().signal)).rejects.toThrow(/connection closed/);
    script.onPrompt = async () => ({ stopReason: "end_turn" });
    await runTurn(input({ firstTurn: false }), () => {}, new AbortController().signal);
    expect(log.filter((l) => l === "open")).toHaveLength(2);
  });
});

describe("Claude after a cancelled turn (F6)", () => {
  it("the session is closed and resumed before the next prompt", async () => {
    blockingPrompt();
    const ac = new AbortController();
    const a = runTurn(input(), () => {}, ac.signal);
    await sleep(30);
    ac.abort();
    await a;
    script.onPrompt = async () => ({ stopReason: "end_turn" });
    await runTurn(input({ firstTurn: false, text: "kiwi" }), () => {}, new AbortController().signal);
    const i = log.indexOf("cancel");
    expect(log.slice(i)).toEqual(["cancel", "closeSession s1", "resumeSession s1", "prompt kiwi"]);
  });
});

describe("permissions", () => {
  const ask = (c: FakeConnT, id: string, title: string, rawInput?: unknown) =>
    c.perms.get(id)!({
      sessionId: id,
      toolCall: { toolCallId: `call-${title}`, title, rawInput },
      options: [
        { optionId: "always", kind: "allow_always", name: "Always" },
        { optionId: "once", kind: "allow_once", name: "Allow" },
        { optionId: "no", kind: "reject_once", name: "Reject" },
      ],
    });

  it("a read-only tool of ours is allowed without asking (F4); OUR order is granted once to the agent (our server asks the user); another server's order asks", async () => {
    const answers: RequestPermissionResponse[] = [];
    const events: WireEvent[] = [];
    script.onPrompt = async (c, id) => {
      answers.push(await ask(c, id, "mcp__bytnode-ai__PositionSize"));
      answers.push(await ask(c, id, "Approve MCP call", { server: "bytnode-ai", tool: "PlaceOrder", arguments: {} }));
      answers.push(await ask(c, id, "mcp__bytnode-ai__Transfer"));
      const other = ask(c, id, "mcp__other__PlaceOrder");
      await sleep(10);
      /* The user clicks « Always »: an order never gets it. */
      expect(answerPermission(`conv-${n}`, "call-mcp__other__PlaceOrder", true, true)).toBe(true);
      answers.push(await other);
      return { stopReason: "end_turn" };
    };
    await runTurn(input(), (e) => events.push(e), new AbortController().signal);
    const once = { outcome: { outcome: "selected", optionId: "once" } };
    expect(answers).toEqual([once, once, once, once]);
    expect(events.filter((e) => e.type === "permission").map((e) => (e as { title: string }).title)).toEqual(["mcp__other__PlaceOrder"]);
  });

  it("in « Run directly », an order that is not ours still asks, and a gated tool of ours does not", async () => {
    const events: WireEvent[] = [];
    const answers: RequestPermissionResponse[] = [];
    script.onPrompt = async (c, id) => {
      answers.push(await ask(c, id, "mcp__bytnode-ai__WatchlistEdit"));
      const order = ask(c, id, "Transfer funds");
      await sleep(10);
      answerPermission(`conv-${n}`, "call-Transfer funds", false, false);
      answers.push(await order);
      return { stopReason: "end_turn" };
    };
    await runTurn(input({ permissionMode: "skip" }), (e) => events.push(e), new AbortController().signal);
    expect(events.filter((e) => e.type === "permission").map((e) => (e as { title: string }).title)).toEqual(["Transfer funds"]);
    expect(answers).toEqual([{ outcome: { outcome: "selected", optionId: "once" } }, { outcome: { outcome: "selected", optionId: "no" } }]);
  });
});

describe("BytNode-AI's own confirmation of a money action (confirmCall)", () => {
  const { confirmCall } = sessions;
  const ORDER = { account: "Bybit-test", symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.001 };
  /** The token our MCP server receives, read from the session's servers. */
  let token = "";
  beforeEach(() => {
    token = "";
    script.onNewSession = (servers) => {
      token = (servers[0] as { env: Array<{ name: string; value: string }> }).env.find((e) => e.name === "BYTNODE_AI_SUBAGENT_TOKEN")!.value;
    };
  });
  const perms = (events: WireEvent[]) => events.filter((e): e is Extract<WireEvent, { type: "permission" }> => e.type === "permission");
  /** The agent opens its call to our PlaceOrder, as Claude Code narrates it. */
  const openCall = (c: FakeConnT, id: string, callId = "toolu_1", rawInput: unknown = ORDER) =>
    c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "tool_call", toolCallId: callId, title: "mcp__bytnode-ai__PlaceOrder", kind: "other", status: "pending", rawInput } });

  it("asks ON the agent's step, with the server's arguments, no « Always », and answers only with the stream's nonce", async () => {
    const events: WireEvent[] = [];
    const verdicts: unknown[] = [];
    script.onPrompt = async (c, id) => {
      openCall(c, id);
      const v = confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
      await sleep(10);
      const [p] = perms(events);
      expect(p).toMatchObject({ id: "toolu_1", title: "mcp__bytnode-ai__PlaceOrder" });
      expect(p.options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
      expect(events).toContainEqual({ type: "tool_update", id: "toolu_1", args: ORDER });
      /* Someone who did not see the stream (the agent itself, by curl)
         cannot answer it. */
      expect(answerPermission(`conv-${n}`, "toolu_1", true, false)).toBe(false);
      expect(answerPermission(`conv-${n}`, "toolu_1", true, true, p.nonce)).toBe(true);
      verdicts.push(await v);
      return { stopReason: "end_turn" };
    };
    await runTurn(input(), (e) => events.push(e), new AbortController().signal);
    expect(verdicts).toEqual([{ allowed: true }]);
    expect(perms(events)).toHaveLength(1);
  });

  it("with the agent's own request for the same call: ONE prompt, ours (Claude: the request is granted once)", async () => {
    const events: WireEvent[] = [];
    const agentAnswers: RequestPermissionResponse[] = [];
    let verdict: unknown;
    script.onPrompt = async (c, id) => {
      openCall(c, id);
      agentAnswers.push(
        await c.perms.get(id)!({
          sessionId: id,
          toolCall: { toolCallId: "toolu_1", title: "mcp__bytnode-ai__PlaceOrder", rawInput: ORDER },
          options: [
            { optionId: "allow_always", kind: "allow_always", name: "Always Allow" },
            { optionId: "allow", kind: "allow_once", name: "Allow" },
            { optionId: "reject", kind: "reject_once", name: "Reject" },
          ],
        }),
      );
      const v = confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
      await sleep(10);
      answerPermission(`conv-${n}`, "toolu_1", false, false, perms(events)[0].nonce);
      verdict = await v;
      return { stopReason: "end_turn" };
    };
    await runTurn(input({ permissionMode: "skip" }), (e) => events.push(e), new AbortController().signal);
    expect(agentAnswers).toEqual([{ outcome: { outcome: "selected", optionId: "allow" } }]);
    expect(perms(events)).toHaveLength(1);
    expect(verdict).toEqual({ allowed: false, reason: "The user denied it: nothing was sent." });
  });

  it("Codex in Run directly asks nothing: our prompt is the only one; a call we cannot find gets its own step", async () => {
    const events: WireEvent[] = [];
    let verdict: unknown;
    script.onNewSession = (servers) => {
      const env = (servers[0] as { env: Array<{ name: string; value: string }> }).env;
      token = env.find((e) => e.name === "BYTNODE_AI_SUBAGENT_TOKEN")!.value;
      setTimeout(() => markToolsReady(env.find((e) => e.name === "BYTNODE_AI_READY_ID")!.value), 10);
    };
    script.onPrompt = async () => {
      const v = confirmCall({ conversationId: `conv-${n}`, token, tool: "ClosePosition", args: { symbol: "BTC/USDT" } }, new AbortController().signal);
      await sleep(10);
      const [p] = perms(events);
      expect(p.id).toMatch(/^confirm-/);
      expect(events).toContainEqual({ type: "tool_call", id: p.id, name: "mcp__bytnode-ai__ClosePosition", args: { symbol: "BTC/USDT" } });
      answerPermission(`conv-${n}`, p.id, true, false, p.nonce);
      verdict = await v;
      return { stopReason: "end_turn" };
    };
    await runTurn(input({ agent: "openai", permissionMode: "skip" }), (e) => events.push(e), new AbortController().signal);
    expect(verdict).toEqual({ allowed: true });
    expect(events).toContainEqual({ type: "tool_result", id: perms(events)[0].id, ok: true, output: "Confirmed." });
  });

  it("refused without asking: a wrong token, no live turn", async () => {
    const events: WireEvent[] = [];
    let wrong: unknown;
    script.onPrompt = async () => {
      wrong = await confirmCall({ conversationId: `conv-${n}`, token: "forged", tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
      return { stopReason: "end_turn" };
    };
    await runTurn(input(), (e) => events.push(e), new AbortController().signal);
    expect(wrong).toEqual({ allowed: false, reason: "Unknown requester: nothing was sent." });
    /* The turn is over: the right token no longer gets a prompt. */
    const after = await confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
    expect(after).toMatchObject({ allowed: false, reason: expect.stringMatching(/^No turn of this conversation is running/) });
    expect(perms(events)).toEqual([]);
  });

  it("a Stop, the server giving up, or 10 minutes without an answer: refused", async () => {
    const verdicts: unknown[] = [];
    script.onPrompt = async (c, id) => {
      openCall(c, id, "t-1");
      openCall(c, id, "t-2");
      /* The MCP server's request is closed (the agent cancelled its call). */
      const gone = new AbortController();
      const v1 = confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, gone.signal);
      await sleep(10);
      gone.abort();
      verdicts.push(await v1);
      /* Nobody answers. */
      vi.useFakeTimers();
      try {
        const v2 = confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        verdicts.push(await v2);
      } finally {
        vi.useRealTimers();
      }
      /* Stop pressed while the prompt waits. */
      const v3 = confirmCall({ conversationId: `conv-${n}`, token, tool: "PlaceOrder", args: ORDER }, new AbortController().signal);
      await sleep(10);
      cancelTurn(`conv-${n}`);
      verdicts.push(await v3);
      return { stopReason: "cancelled" };
    };
    await runTurn(input(), () => {}, new AbortController().signal);
    expect(verdicts).toEqual([
      { allowed: false, reason: "The request was interrupted: nothing was sent." },
      { allowed: false, reason: "No answer from the user in 10 minutes: nothing was sent." },
      { allowed: false, reason: "The turn was stopped: nothing was sent." },
    ]);
  });
});

describe("Codex in « Ask before acting » (P0-3)", () => {
  const codex = (over: Partial<Parameters<typeof runTurn>[0]> = {}) => input({ agent: "openai", ...over });
  beforeEach(() => {
    /* Our MCP server announces its tools shortly after the session opens. */
    script.onNewSession = (servers) => {
      const id = (servers[0] as { env: Array<{ name: string; value: string }> }).env.find((e) => e.name === "BYTNODE_AI_READY_ID")?.value;
      if (id) setTimeout(() => markToolsReady(id), 20);
    };
  });

  it("runs in its read-only mode, and goes back to its own mode in « Run directly »", async () => {
    await runTurn(codex(), () => {}, new AbortController().signal);
    expect(log.indexOf("setConfig mode=read-only")).toBeLessThan(log.findIndex((l) => l.startsWith("prompt")));
    await runTurn(codex({ permissionMode: "skip", firstTurn: false }), () => {}, new AbortController().signal);
    expect(log.filter((l) => l.startsWith("setConfig mode"))).toEqual(["setConfig mode=read-only", "setConfig mode=agent"]);
  });

  it("waits for our tools before the first prompt (F3)", async () => {
    let at = 0;
    script.onNewSession = (servers) => {
      const id = (servers[0] as { env: Array<{ name: string; value: string }> }).env.find((e) => e.name === "BYTNODE_AI_READY_ID")!.value;
      setTimeout(() => {
        at = Date.now();
        markToolsReady(id);
      }, 200);
    };
    let promptedAt = 0;
    script.onPrompt = async () => {
      promptedAt = Date.now();
      return { stopReason: "end_turn" };
    };
    await runTurn(codex(), () => {}, new AbortController().signal);
    expect(at).toBeGreaterThan(0);
    expect(promptedAt).toBeGreaterThanOrEqual(at);
  });

  it("an MCP request with an empty title: a read-only tool passes, OUR order is granted once (our server confirms it), an unidentified one asks", async () => {
    const events: WireEvent[] = [];
    const answers: RequestPermissionResponse[] = [];
    const opts = [
      { optionId: "allow_once", kind: "allow_once" as const, name: "Allow" },
      { optionId: "allow_always", kind: "allow_always" as const, name: "Always allow" },
      { optionId: "cancel", kind: "reject_once" as const, name: "Cancel" },
    ];
    script.onPrompt = async (c, id) => {
      const call = (callId: string, tool: string) => {
        c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "tool_call", toolCallId: callId, title: `mcp.bytnode-ai.${tool}`, kind: "execute", status: "in_progress", rawInput: { server: "bytnode-ai", tool, arguments: {} } } });
        return c.perms.get(id)!({ sessionId: id, toolCall: { toolCallId: callId, title: "" }, options: opts });
      };
      answers.push(await call("exec-1", "PositionSize"));
      answers.push(await call("exec-2", "PlaceOrder"));
      /* Nothing at all to go by: asked, even in Run directly. */
      const blind = c.perms.get(id)!({ sessionId: id, toolCall: { toolCallId: "exec-3", title: "" }, options: opts });
      await sleep(10);
      answerPermission(`conv-${n}`, "exec-3", false, false);
      answers.push(await blind);
      return { stopReason: "end_turn" };
    };
    await runTurn(codex(), (e) => events.push(e), new AbortController().signal);
    expect(answers[0]).toEqual({ outcome: { outcome: "selected", optionId: "allow_once" } });
    expect(events.filter((e) => e.type === "permission").map((e) => (e as { title: string }).title)).toEqual([""]);
    expect(answers[1]).toEqual({ outcome: { outcome: "selected", optionId: "allow_once" } });
    expect(answers[2]).toEqual({ outcome: { outcome: "selected", optionId: "cancel" } });
  });

  it("a refusal that ends its turn closes the refused call and is not an interruption", async () => {
    const events: WireEvent[] = [];
    script.onPrompt = async (c, id) => {
      c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "tool_call", toolCallId: "exec-1", title: "Editing files", kind: "edit", status: "pending" } });
      const p = c.perms.get(id)!({
        sessionId: id,
        toolCall: { toolCallId: "exec-1", title: "Edit files" },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Yes" },
          { optionId: "cancel", kind: "reject_once", name: "No" },
        ],
      });
      await sleep(10);
      answerPermission(`conv-${n}`, "exec-1", false, false);
      await p;
      return { stopReason: "cancelled" };
    };
    await runTurn(codex(), (e) => events.push(e), new AbortController().signal);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ id: "exec-1", ok: false });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "end_turn" });
  });
});

describe("the turn's cost", () => {
  it("is what this turn added to the session's running total", async () => {
    const costs: number[] = [];
    let total = 0;
    script.onPrompt = async (c, id) => {
      total += 0.01;
      c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "usage_update", used: 100, size: 1000, cost: { amount: total, currency: "USD" } } });
      return { stopReason: "end_turn" };
    };
    const collect = (e: WireEvent) => e.type === "usage" && typeof e.usage.cost === "number" && costs.push(e.usage.cost);
    await runTurn(input(), collect, new AbortController().signal);
    await runTurn(input({ firstTurn: false }), collect, new AbortController().signal);
    expect(costs[0]).toBeCloseTo(0.01);
    expect(costs[1]).toBeCloseTo(0.01);
  });
});

/* After a Stop, the agent takes seconds to acknowledge the cancel: the next
   message used to get "already has a turn in progress" for 5–7 s. */
describe("a message sent right after Stop (NEW-1)", () => {
  it("waits for the stopped turn to be released instead of being refused", async () => {
    const first = sessions.claimTurn("after-stop")!;
    first.cancelled = true;
    setTimeout(() => sessions.releaseTurn(first), 50);
    const next = await sessions.claimTurnAfterStop("after-stop", new AbortController().signal, 5_000);
    expect(next).not.toBeNull();
    sessions.releaseTurn(next!);
  });

  it("a turn that is really running is still refused at once", async () => {
    const running = sessions.claimTurn("still-running")!;
    const started = Date.now();
    expect(await sessions.claimTurnAfterStop("still-running", new AbortController().signal, 5_000)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    sessions.releaseTurn(running);
  });
});

/* The agents' own commands (`/goal`, `/usage`…) behave as in their
   terminals: they must reach the agent exactly as typed. */
describe("an agent's own command", () => {
  const COMMANDS = [
    { name: "goal", description: "Set a goal" },
    { name: "status", description: "Status" },
    { name: "pdf:pdf", description: "PDF skill", trigger: "$" as const },
  ];
  beforeEach(() => {
    /* Codex waits for our MCP server's tools: announced at once here. */
    script.onNewSession = (servers) => {
      const id = (servers[0] as { env: Array<{ name: string; value: string }> }).env.find((e) => e.name === "BYTNODE_AI_READY_ID")?.value;
      if (id) setTimeout(() => markToolsReady(id), 5);
    };
  });

  it("Codex: a first message that is a command goes as typed; the context waits for the next ordinary message", async () => {
    script.commands = COMMANDS;
    await runTurn(input({ agent: "openai", text: "/goal ship the report" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toBe("/goal ship the report");
    await runTurn(input({ agent: "openai", text: "and now?", firstTurn: false }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toContain("<bytnode_ai_context>\nsys\n</bytnode_ai_context>");
    expect(sent.at(-1)!.endsWith("and now?")).toBe(true);
    /* Told once: the message after that goes alone. */
    await runTurn(input({ agent: "openai", text: "thanks", firstTurn: false }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toBe("thanks");
  });

  it("an ordinary first message still carries the context, a $skill included, and a /path that is no command too", async () => {
    script.commands = COMMANDS;
    await runTurn(input({ agent: "openai", text: "$pdf:pdf read the file" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toContain("<bytnode_ai_context>");
    n++;
    await runTurn(input({ agent: "openai", text: "/api/v3 returns 500" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toContain("<bytnode_ai_context>");
  });

  it("with no list published yet, a /word is taken as a command", async () => {
    await runTurn(input({ agent: "openai", text: "/status" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toBe("/status");
  });

  it("Claude reopened on an old thread: the command goes alone, the previous thread comes with the next message", async () => {
    script.commands = [{ name: "usage", description: "Usage" }];
    await runTurn(input({ text: "/usage", firstTurn: false, history: "user: hi" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toBe("/usage");
    await runTurn(input({ text: "go on", firstTurn: false, history: "user: hi" }), () => {}, new AbortController().signal);
    expect(sent.at(-1)).toBe("<previous_thread>\nuser: hi\n</previous_thread>\n\ngo on");
  });

  it("Claude: a local command's answer is read back from its transcript, and /model moves the conversation's picker", async () => {
    script.commands = [{ name: "model", description: "Set the model" }];
    script.localOutputs = ["Set model to `Haiku 4.5` for this session only"];
    const events: WireEvent[] = [];
    const MODEL = { id: "model", name: "Model", category: "model", type: "select", currentValue: "opus", options: [{ value: "opus", name: "Opus 5.5" }, { value: "haiku", name: "Haiku 4.5" }] };
    script.onNewSession = () => {};
    const newSession = (await import("./connection")).AcpConnection.prototype as unknown as { newSession: () => Promise<unknown> };
    const original = newSession.newSession;
    newSession.newSession = async function () {
      return { sessionId: "s1", configOptions: [MODES.claude, MODEL] };
    };
    try {
      await runTurn(input({ text: "/model haiku" }), (e) => events.push(e), new AbortController().signal);
    } finally {
      newSession.newSession = original;
    }
    expect(events).toContainEqual({ type: "text", text: "Set model to `Haiku 4.5` for this session only" });
    expect(events).toContainEqual({ type: "agent_config", modelId: "acp:claude/haiku" });
    expect(events).toContainEqual({ type: "commands", commands: script.commands });
    /* The next turn, with the picker on haiku, changes nothing. */
    await runTurn(input({ text: "hi", firstTurn: false, modelId: "haiku" }), () => {}, new AbortController().signal);
    expect(log.filter((l) => l.startsWith("setConfig model"))).toEqual([]);
  });

  it("a turn that spoke is not doubled by the transcript", async () => {
    script.commands = [{ name: "context", description: "Context" }];
    script.localOutputs = ["## Context Usage"];
    script.onPrompt = async (c, id) => {
      c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "## Context Usage" } } });
      return { stopReason: "end_turn" };
    };
    const events: WireEvent[] = [];
    await runTurn(input({ text: "/context" }), (e) => events.push(e), new AbortController().signal);
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("the agent leaving its plan mode moves the conversation's mode picker", async () => {
    script.onPrompt = async (c, id) => {
      c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "current_mode_update", currentModeId: "default" } });
      return { stopReason: "end_turn" };
    };
    const events: WireEvent[] = [];
    await runTurn(input({ text: "plan it", mode: "plan" }), (e) => events.push(e), new AbortController().signal);
    expect(events).toContainEqual({ type: "agent_config", mode: "default" });
  });

  it("/goal: « Goal set » comes before the model's first word, the verdict closes the reply", async () => {
    script.commands = [{ name: "goal", description: "Set a goal" }];
    script.localOutputs = ["Goal set: say kiwi"];
    script.goal = "**Goal met** — the last message is kiwi";
    script.onPrompt = async (c, id) => {
      c.updates.get(id)!({ sessionId: id, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "kiwi" } } });
      return { stopReason: "end_turn" };
    };
    const events: WireEvent[] = [];
    await runTurn(input({ text: "/goal say kiwi" }), (e) => events.push(e), new AbortController().signal);
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "Goal set: say kiwi\n\n" },
      { type: "text", text: "kiwi" },
      { type: "text", text: "\n\n**Goal met** — the last message is kiwi" },
    ]);
    /* Met: the next turn no longer looks for a verdict. */
    const after: WireEvent[] = [];
    await runTurn(input({ text: "thanks", firstTurn: false }), (e) => after.push(e), new AbortController().signal);
    expect(after.filter((e) => e.type === "text").map((e) => (e as { text: string }).text)).toEqual(["kiwi"]);
  });
});
