import { afterEach, describe, expect, it, vi } from "vitest";
import { acpWorkflowTool, agentModels, announceReady, confirmThroughApp, parentLinkFromEnv, readyLinkFromEnv } from "./acp-workflow";

const link = { conversationId: "c1", origin: "http://localhost:3777", token: "t0k", agent: "claude" };
const none = { openrouterKey: "", bytnodeKey: "", exchangeAccounts: [], plugins: null };

describe("parentLinkFromEnv", () => {
  it("lit les quatre variables, et rien s'il en manque une", () => {
    expect(
      parentLinkFromEnv({ BYTNODE_AI_PARENT: "c1", BYTNODE_AI_ORIGIN: "http://localhost:3777", BYTNODE_AI_SUBAGENT_TOKEN: "t0k", BYTNODE_AI_ACP_AGENT: "claude" }),
    ).toEqual(link);
    expect(parentLinkFromEnv({ BYTNODE_AI_PARENT: "c1", BYTNODE_AI_ORIGIN: "http://localhost:3777" })).toBeNull();
    expect(parentLinkFromEnv({})).toBeNull();
  });
});

describe("readyLinkFromEnv / announceReady (F3: Codex does not wait for our tools)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("needs both the origin and the id", () => {
    expect(readyLinkFromEnv({ BYTNODE_AI_ORIGIN: "http://127.0.0.1:3777", BYTNODE_AI_READY_ID: "r1" })).toEqual({ origin: "http://127.0.0.1:3777", id: "r1" });
    expect(readyLinkFromEnv({ BYTNODE_AI_ORIGIN: "http://127.0.0.1:3777" })).toBeNull();
    expect(readyLinkFromEnv({ BYTNODE_AI_READY_ID: "r1" })).toBeNull();
  });

  it("posts the id to /api/acp/ready, and swallows a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    await announceReady({ origin: "http://127.0.0.1:3777", id: "r1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3777/api/acp/ready");
    expect(JSON.parse(String(init?.body))).toEqual({ id: "r1" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    await expect(announceReady({ origin: "http://127.0.0.1:3777", id: "r1" })).resolves.toBeUndefined();
  });
});

describe("agentModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rend les ids tels que l'agent les connait, sans le prefixe acp:", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ models: [{ id: "acp:claude/opus" }, { id: "acp:claude/haiku" }] })),
    );
    expect(await agentModels(link)).toEqual(["opus", "haiku"]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://localhost:3777/api/acp/models?agent=claude");
  });

  it("rend vide sans liste utile, ou quand le serveur ne repond pas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ id: "acp:copilot/default" }] })));
    expect(await agentModels({ ...link, agent: "copilot" })).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await agentModels(link)).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await agentModels(link)).toEqual([]);
  });
});

describe("acpWorkflowTool", () => {
  afterEach(() => vi.unstubAllGlobals());

  const ctx = { depth: 0, signal: new AbortController().signal } as Parameters<ReturnType<typeof acpWorkflowTool>["execute"]>[1];

  it("borne le modele a la liste et refuse la profondeur 1", async () => {
    const tool = acpWorkflowTool(link, ["opus", "haiku"], none);
    expect(tool.parameters.properties).toHaveProperty("tasks");
    const items = (tool.parameters.properties.tasks as { items: { properties: { model: { enum: string[] } } } }).items;
    expect(items.properties.model.enum).toEqual(["opus", "haiku"]);
    const r = await tool.execute({ tasks: [] }, { ...ctx, depth: 1 });
    expect(r.ok).toBe(false);
  });

  it("envoie chaque tache au serveur avec le jeton, et assemble les rapports en sections", async () => {
    const ndjson = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200 });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { profession: string; text: string; token: string; model: string | null };
      if (body.profession === "quantitatif") return ndjson([{ type: "tick" }, { type: "error", message: "Python absent" }]);
      return ndjson([{ type: "tick" }, { type: "done", report: `Rapport ${body.profession} (${body.model ?? "courant"}) : ${body.text}` }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const tool = acpWorkflowTool(link, [], { ...none, bytnodeKey: "bn-key" });
    const r = await tool.execute(
      {
        tasks: [
          { title: "Funding", profession: "analyste", prompt: "Lis le funding.", model: "haiku" },
          { title: "Backtest", profession: "quantitatif", prompt: "Teste." },
        ],
        context: "BTC.",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.output).toBe(
      "## Funding — Analyst\n\nRapport analyste (haiku) : BTC.\n\nLis le funding.\n\n## Backtest — Quantitative\n\n[failed: Python absent]",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3777/api/acp/subagent");
    expect((init.headers as Record<string, string>)["x-bytnode-key"]).toBe("bn-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ conversationId: "c1", token: "t0k", profession: "analyste", model: "haiku" });
  });
});

describe("confirmThroughApp (a money action waits for the user)", () => {
  /** A streamed answer, one JSON object per line, in chunks cut anywhere. */
  const ndjson = (...lines: unknown[]) => {
    const text = lines.map((l) => `${JSON.stringify(l)}\n`).join("");
    const bytes = new TextEncoder().encode(text);
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
          c.close();
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    );
  };
  const signal = new AbortController().signal;
  const ORDER = { symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.001 };

  it("posts the tool and its arguments with the conversation's token, and waits through the ticks", async () => {
    const f = vi.fn(async () => ndjson({ type: "tick" }, { type: "tick" }, { type: "done", allowed: true }));
    expect(await confirmThroughApp(link, "PlaceOrder", ORDER, signal, f as unknown as typeof fetch)).toEqual({ allowed: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3777/api/acp/confirm");
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: "c1", token: "t0k", tool: "PlaceOrder", args: ORDER });
  });

  it("a denial keeps the app's reason", async () => {
    const f = async () => ndjson({ type: "done", allowed: false, reason: "The user denied it: nothing was sent." });
    expect(await confirmThroughApp(link, "PlaceOrder", ORDER, signal, f as unknown as typeof fetch)).toEqual({ allowed: false, reason: "The user denied it: nothing was sent." });
  });

  it("anything but an explicit yes is a refusal: a truthy non-boolean, a stream cut short, an error status, the app unreachable", async () => {
    const answers = [
      async () => ndjson({ type: "done", allowed: "true" }),
      async () => ndjson({ type: "tick" }),
      async () => Response.json({ error: { message: "Missing conversation, token, tool or arguments." } }, { status: 400 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const f of answers) {
      const v = await confirmThroughApp(link, "PlaceOrder", ORDER, signal, f as unknown as typeof fetch);
      expect(v.allowed).toBe(false);
      expect("reason" in v && v.reason).toMatch(/nothing was sent/);
    }
  });
});
