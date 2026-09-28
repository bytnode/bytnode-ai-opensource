/* eslint-disable react-hooks/rules-of-hooks -- the hook runs outside a renderer here, React mocked below */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, Conversation, Settings } from "@/lib/domain/types";
import { STOPPED } from "./stop";

/* ---------------------------------------------------------------------------
   The chat turn (`components/chat/use-chat.ts`) end to end, without a
   renderer: React's hooks are reduced to what a single call needs, the
   model is scripted, the tools are recorded. What the turn writes is read
   back from the conversations store.
--------------------------------------------------------------------------- */

vi.mock("react", () => ({
  useCallback: <T,>(fn: T) => fn,
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => {}] as const,
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
}));

type Call = { messages: Array<{ role: string; content: unknown }>; signal?: AbortSignal };
const script: Array<(call: Call) => AsyncIterable<unknown>> = [];
vi.mock("@/lib/llm/client", () => {
  class LlmError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = "LlmError";
    }
  }
  class OpenRouterClient {
    streamChat(call: Call) {
      const next = script.shift();
      if (!next) throw new Error("no script");
      return next(call);
    }
  }
  return { LlmError, OpenRouterClient };
});

const executed: string[] = [];
vi.mock("@/lib/tools/client", () => ({
  fetchToolset: vi.fn(async () => ({
    workspace: "W",
    tools: [],
    policies: { Bash: { readOnly: false, gated: true, alwaysAsk: false, subagent: false } },
    skills: [],
    platform: "win32",
    profession: { id: "analyst", prompt: "" },
    bytnode: { ok: false, count: 0 },
  })),
  executeTool: vi.fn(async (call: { args: { command: string } }) => {
    executed.push(call.args.command);
    return { ok: true, output: "ok" };
  }),
}));

const data = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
};
(globalThis as Record<string, unknown>).requestAnimationFrame = (f: () => void) => setTimeout(f, 1) as unknown as number;
(globalThis as Record<string, unknown>).cancelAnimationFrame = (h: number) => clearTimeout(h);
(globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, status: 200, json: async () => ({ prompt: "" }), text: async () => '{"prompt":""}' });

const mkAgent = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "a1", createdAt: 1, name: "A", profession: "analyst" as AgentConfig["profession"], providerId: "openai", defaultModelId: "m", defaultEffort: null,
  workspace: "", permissionMode: "ask", scope: "workspace", allowRules: [], exchangeAccountIds: [], contextText: "", contextFiles: [], ...over,
});

async function* bash(id: string, command: string, cost = 0.01) {
  yield { text: "", toolCalls: [{ index: 0, id, name: "Bash", args: JSON.stringify({ command }) }] };
  yield { text: "", finish: "tool_calls", usage: { input: 1000, output: 20, cost } };
}
async function* reply(text: string, cost = 0.01) {
  yield { text };
  yield { text: "", finish: "stop", usage: { input: 1100, output: 5, cost } };
}
async function* fail(message: string, status: number): AsyncGenerator<unknown> {
  const { LlmError } = await import("@/lib/llm/client");
  throw new LlmError(message, status);
}

/** The agent in the settings store, as the app holds it; and a chat on it. */
async function setup(agent: AgentConfig, conversationId: string | null = null) {
  const { updateSettings, currentSettings } = await import("@/lib/state/settings");
  updateSettings((s) => ({ ...s, onboardingDone: true, authMode: "keys", keys: { ...s.keys, openrouter: "k" }, agents: [agent], activeAgentId: agent.id }));
  const { useChat } = await import("@/components/chat/use-chat");
  const conversations = await import("@/lib/state/conversations");
  let created = conversationId ?? "";
  const rules: string[] = [];
  const chat = useChat({
    settings: currentSettings() as Settings,
    agent,
    conversationId,
    modelId: "m",
    effort: null,
    mode: null,
    window: 100_000,
    onConversationCreated: (id) => (created = id),
    onAllowRule: (_agentId, rule) => rules.push(rule),
  });
  return { chat, updateSettings, conversations, id: () => created };
}

const until = async (cond: () => boolean, ms = 15_000) => {
  for (let t = 0; t < ms && !cond(); t += 5) await new Promise((r) => setTimeout(r, 5));
  return cond();
};

beforeEach(() => {
  data.clear();
  executed.length = 0;
  script.length = 0;
  vi.resetModules();
});

/* The first import of the chat hook pulls a large module graph: under a
   full parallel run, 5 s is not enough. */
describe("a chat turn", { timeout: 30_000 }, () => {
  it("switching the header to 'Ask before acting' mid-turn applies to the NEXT tool call of the running turn", async () => {
    const agent = mkAgent({ permissionMode: "skip" });
    const { chat, updateSettings, conversations, id } = await setup(agent);
    script.push(() => bash("t1", "echo first"));
    script.push(() => {
      /* The user clicks the header toggle while the agent works. */
      updateSettings((s) => ({ ...s, agents: s.agents.map((a) => ({ ...a, permissionMode: "ask" as const })) }));
      return bash("t2", "rm -r data");
    });
    script.push(() => reply("done"));
    const turn = chat.send("clean up");
    const steps = () => (conversations.getConversation(id())?.messages.at(-1)?.steps ?? []) as Array<{ type: string; id?: string; status?: string }>;
    expect(await until(() => steps().some((s) => s.id === "t2" && s.status === "pending"))).toBe(true);
    chat.answer("t2", false);
    await turn;
    expect(executed).toEqual(["echo first"]);
    expect(steps().find((s) => s.id === "t2")?.status).toBe("denied");
  });

  it("the reply's cost is the SUM of the turn's model calls", async () => {
    const { chat, conversations, id } = await setup(mkAgent({ permissionMode: "skip" }));
    script.push(() => bash("t1", "ls", 0.05));
    script.push(() => bash("t2", "dir", 0.05));
    script.push(() => reply("done", 0.05));
    await chat.send("go");
    const usage = conversations.getConversation(id())!.messages.at(-1)!.usage!;
    expect(usage.cost).toBeCloseTo(0.15);
    expect(usage.input).toBe(1100); // the context meter keeps the LAST call's count
  });

  it("overflow, then the recovery compaction fails: the user's new message stays, with why, and Retry resends it", async () => {
    const { saveConversation } = await import("@/lib/state/conversations");
    const prior: Conversation = {
      id: "c1", agentId: "a1", title: "t", modelId: "m", createdAt: 1, updatedAt: 1,
      messages: [
        { id: "u0", role: "user", content: "earlier question", createdAt: 1 },
        { id: "r0", role: "assistant", content: "earlier answer", createdAt: 1, steps: [{ type: "text", text: "earlier answer" }] },
      ],
    };
    saveConversation(prior);
    const { chat, conversations } = await setup(mkAgent(), "c1");
    script.push(() => fail("This endpoint's maximum context length is 128000 tokens. However, you requested about 140000 tokens.", 400));
    script.push(() => fail("Insufficient credits. Add more using https://openrouter.ai/settings/credits", 402));
    await chat.send("MY IMPORTANT NEW QUESTION");
    const after = conversations.getConversation("c1")!.messages;
    expect(after.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(after[2].content).toBe("MY IMPORTANT NEW QUESTION");
    expect(after[3].error).toMatch(/compacting the thread failed: Insufficient credits/);
    expect(after.some((m) => m.compacting)).toBe(false);
    /* Retry: the question goes again (here the provider accepts it). */
    script.push(() => reply("the answer"));
    chat.retry();
    const last = () => conversations.getConversation("c1")!.messages;
    expect(await until(() => last().at(-1)?.content === "the answer")).toBe(true);
    expect(last().map((m) => m.content)).toEqual(["earlier question", "earlier answer", "MY IMPORTANT NEW QUESTION", "the answer"]);
  });

  it("a stopped reply keeps its text, is marked stopped, and Continue resumes it in place", async () => {
    const { chat, conversations, id } = await setup(mkAgent());
    script.push(async function* (call) {
      yield { text: "The first weeks after Leh" };
      await new Promise((_, reject) => call.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    });
    const turn = chat.send("tell me a long story");
    const last = () => conversations.getConversation(id())?.messages.at(-1);
    expect(await until(() => (last()?.content.length ?? 0) > 10)).toBe(true);
    chat.stop();
    await turn;
    expect(last()!.content).toBe("The first weeks after Leh");
    expect(last()!.error).toBe(STOPPED);
    /* Continue = the resume path: no new message, the model reads its own
       partial reply, then the resume prompt. */
    const seen: string[] = [];
    script.push((call) => {
      seen.push(...call.messages.slice(-2).map((m) => `${m.role}: ${String(m.content).slice(0, 25)}`));
      return reply("aucune");
    });
    const { useChat } = await import("@/components/chat/use-chat");
    const { currentSettings } = await import("@/lib/state/settings");
    const again = useChat({ settings: currentSettings(), agent: mkAgent(), conversationId: id(), modelId: "m", effort: null, mode: null, window: null, onConversationCreated: () => {}, onAllowRule: () => {} });
    again.retry();
    expect(await until(() => last()?.error === undefined && last()!.content.endsWith("aucune"))).toBe(true);
    const messages = conversations.getConversation(id())!.messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(seen[0]).toMatch(/^assistant: The first weeks/);
    expect(seen[1]).toMatch(/^user: Your previous reply was/);
  });
});
