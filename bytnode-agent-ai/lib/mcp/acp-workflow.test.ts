import { afterEach, describe, expect, it, vi } from "vitest";
import { acpWorkflowTool, agentModels, parentLinkFromEnv } from "./acp-workflow";

const link = { conversationId: "c1", origin: "http://localhost:3777", token: "t0k", agent: "claude" };

describe("parentLinkFromEnv", () => {
  it("lit les quatre variables, et rien s'il en manque une", () => {
    expect(
      parentLinkFromEnv({ BYTNODE_AI_PARENT: "c1", BYTNODE_AI_ORIGIN: "http://localhost:3777", BYTNODE_AI_SUBAGENT_TOKEN: "t0k", BYTNODE_AI_ACP_AGENT: "claude" }),
    ).toEqual(link);
    expect(parentLinkFromEnv({ BYTNODE_AI_PARENT: "c1", BYTNODE_AI_ORIGIN: "http://localhost:3777" })).toBeNull();
    expect(parentLinkFromEnv({})).toBeNull();
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
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ id: "acp:gemini/default" }] })));
    expect(await agentModels({ ...link, agent: "gemini" })).toEqual([]);
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
    const tool = acpWorkflowTool(link, ["opus", "haiku"], "", []);
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
    const tool = acpWorkflowTool(link, [], "bn-key", []);
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
      "## Funding — Analyste\n\nRapport analyste (haiku) : BTC.\n\nLis le funding.\n\n## Backtest — Quantitatif\n\n[échec : Python absent]",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3777/api/acp/subagent");
    expect((init.headers as Record<string, string>)["x-bytnode-key"]).toBe("bn-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ conversationId: "c1", token: "t0k", profession: "analyste", model: "haiku" });
  });
});
