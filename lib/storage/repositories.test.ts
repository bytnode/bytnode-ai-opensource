import { describe, expect, test } from "vitest";
import { MemoryStorage } from "./storage";
import { ConversationsRepository, LEGACY_AGENT_ID, SettingsRepository, StorageFullError, defaultSettings } from "./repositories";
import type { Conversation } from "@/lib/domain/types";

const conv = (id: string, updatedAt: number): Conversation => ({
  id,
  agentId: "a1",
  title: `c${id}`,
  modelId: "openai/gpt-4o",
  createdAt: updatedAt,
  updatedAt,
  messages: [],
});

describe("SettingsRepository", () => {
  test("returns defaults when nothing is stored", () => {
    const repo = new SettingsRepository(new MemoryStorage());
    expect(repo.load()).toEqual(defaultSettings());
    expect(repo.load().onboardingDone).toBe(false);
  });

  test("round-trips what was saved", () => {
    const repo = new SettingsRepository(new MemoryStorage());
    const s = { ...defaultSettings(), onboardingDone: true, profile: { firstName: "O", lastName: "F", email: "", bio: "" } };
    repo.save(s);
    expect(repo.load()).toEqual(s);
  });

  test("falls back to defaults on corrupt data, filling missing fields", () => {
    const store = new MemoryStorage();
    store.set("agentchat:settings", "{not json");
    expect(new SettingsRepository(store).load()).toEqual(defaultSettings());

    store.set("agentchat:settings", JSON.stringify({ version: 1, profile: { firstName: "O" } }));
    const loaded = new SettingsRepository(store).load();
    expect(loaded.profile.firstName).toBe("O");
    expect(loaded.profile.lastName).toBe("");
    expect(loaded.profile.bio).toBe("");
    expect(loaded.keys.openrouter).toBe("");
    expect(loaded.agents).toEqual([]);
    expect(loaded.activeAgentId).toBeNull();
  });

  test("migrates a v1 single agent into the agents list under the legacy id", () => {
    const store = new MemoryStorage();
    store.set(
      "agentchat:settings",
      JSON.stringify({
        version: 1,
        onboardingDone: true,
        agent: { name: "Nova", providerId: "anthropic", defaultModelId: "anthropic/claude-opus-5", contextText: "ctx", contextFiles: [] },
      }),
    );
    const loaded = new SettingsRepository(store).load();
    expect(loaded.version).toBe(4);
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]).toMatchObject({ id: LEGACY_AGENT_ID, name: "Nova", providerId: "anthropic", contextText: "ctx" });
    expect(loaded.activeAgentId).toBe(LEGACY_AGENT_ID);
  });

  test("v3: exchange accounts and per-agent accounts, with defaults for v2", () => {
    const storage = new MemoryStorage();
    storage.set(
      "agentchat:settings",
      JSON.stringify({
        version: 2,
        onboardingDone: true,
        keys: { openrouter: "k", bytnode: "" },
        agents: [{ id: "a1", name: "A", providerId: "openai" }],
        activeAgentId: "a1",
      }),
    );
    const s = new SettingsRepository(storage).load();
    expect(s.version).toBe(4);
    expect(s.keys.exchanges).toEqual([]);
    expect(s.agents[0].exchangeAccountIds).toEqual([]);
  });

  test("v3: keeps valid exchange accounts and ignores malformed entries", () => {
    const storage = new MemoryStorage();
    storage.set(
      "agentchat:settings",
      JSON.stringify({
        version: 3,
        keys: {
          openrouter: "k",
          bytnode: "",
          exchanges: [
            { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", testnet: false },
            { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "p", testnet: true },
            { label: "no id" },
            "whatever",
          ],
        },
        agents: [{ id: "a1", name: "A", providerId: "openai", exchangeAccountIds: ["x1", 42, "x9"] }],
        activeAgentId: "a1",
      }),
    );
    const s = new SettingsRepository(storage).load();
    expect(s.keys.exchanges).toEqual([
      { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false },
      { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "p", testnet: true },
    ]);
    expect(s.agents[0].exchangeAccountIds).toEqual(["x1", "x9"]);
  });

  test("keeps a v2 agents list and its active id", () => {
    const repo = new SettingsRepository(new MemoryStorage());
    const s = {
      ...defaultSettings(),
      agents: [
        { id: "a", name: "A", profession: "standard" as const, providerId: "openai", defaultModelId: null, defaultEffort: null, workspace: "", permissionMode: "ask" as const, scope: "workspace" as const, allowRules: [], exchangeAccountIds: [], contextText: "", contextFiles: [], createdAt: 1 },
        { id: "b", name: "B", profession: "quantitatif" as const, providerId: "google", defaultModelId: null, defaultEffort: "high", workspace: "C:/proj", permissionMode: "skip" as const, scope: "disk" as const, allowRules: ["Write", "Bash(git status *)"], exchangeAccountIds: [], contextText: "", contextFiles: [], createdAt: 2 },
      ],
      activeAgentId: "b",
    };
    repo.save(s);
    expect(repo.load()).toEqual(s);
  });

  test("v4: plugins start enabled; a stored switch, config and agents are kept, the rest dropped", () => {
    const storage = new MemoryStorage();
    storage.set(
      "agentchat:settings",
      JSON.stringify({
        version: 3,
        plugins: {
          watchlist: { enabled: false, config: { size: 3, label: "x", nested: { no: 1 } }, agentIds: ["a1", 2] },
          alerts: { config: {} },
          broken: "yes",
        },
      }),
    );
    const s = new SettingsRepository(storage).load();
    expect(s.version).toBe(4);
    expect(s.plugins).toEqual({
      watchlist: { enabled: false, config: { size: 3, label: "x" }, agentIds: ["a1"] },
      alerts: { enabled: true, config: {}, agentIds: null },
    });
    expect(new SettingsRepository(new MemoryStorage()).load().plugins).toEqual({});
  });
  test("an agent on Gemini CLI (removed) moves to Gemini through OpenRouter, keeping the rest", () => {
    const repo = new SettingsRepository(new MemoryStorage());
    const old = { id: "g", name: "G", profession: "standard" as const, providerId: "acp:gemini", defaultModelId: "acp:gemini/auto", defaultEffort: "high", workspace: "C:/proj", permissionMode: "ask" as const, scope: "workspace" as const, allowRules: ["Write"], exchangeAccountIds: [], contextText: "ctx", contextFiles: [], createdAt: 3 };
    repo.save({ ...defaultSettings(), agents: [old], activeAgentId: "g" });
    expect(repo.load().agents).toEqual([{ ...old, providerId: "google", defaultModelId: null, defaultEffort: null }]);
  });

  test("the language: English when absent or unknown, a known one kept", () => {
    const store = new MemoryStorage();
    store.set("agentchat:settings", JSON.stringify({ version: 4 }));
    expect(new SettingsRepository(store).load().language).toBe("en");
    store.set("agentchat:settings", JSON.stringify({ version: 4, language: "zh" }));
    expect(new SettingsRepository(store).load().language).toBe("zh");
    store.set("agentchat:settings", JSON.stringify({ version: 4, language: "it" }));
    expect(new SettingsRepository(store).load().language).toBe("en");
  });

  test("drops an active id that names no agent", () => {
    const store = new MemoryStorage();
    store.set("agentchat:settings", JSON.stringify({ version: 2, agents: [], activeAgentId: "ghost" }));
    expect(new SettingsRepository(store).load().activeAgentId).toBeNull();
  });
});

describe("ConversationsRepository", () => {
  test("lists conversations most recently updated first", () => {
    const repo = new ConversationsRepository(new MemoryStorage());
    repo.save(conv("a", 10));
    repo.save(conv("b", 30));
    repo.save(conv("c", 20));
    expect(repo.list().map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  test("saving an existing id replaces it", () => {
    const repo = new ConversationsRepository(new MemoryStorage());
    repo.save(conv("a", 10));
    repo.save({ ...conv("a", 50), title: "renamed" });
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].title).toBe("renamed");
  });

  test("removes by id", () => {
    const repo = new ConversationsRepository(new MemoryStorage());
    repo.save(conv("a", 10));
    repo.remove("a");
    expect(repo.list()).toEqual([]);
  });

  test("ignores corrupt storage", () => {
    const store = new MemoryStorage();
    store.set("agentchat:conversations", "[1, 2");
    expect(new ConversationsRepository(store).list()).toEqual([]);
  });

  test("attaches v1 conversations (no agentId) to the legacy agent", () => {
    const store = new MemoryStorage();
    const { agentId: _drop, ...v1 } = conv("a", 10);
    void _drop;
    store.set("agentchat:conversations", JSON.stringify([v1]));
    expect(new ConversationsRepository(store).list()[0].agentId).toBe(LEGACY_AGENT_ID);
  });
});

/* A storage with a bounded capacity, like a browser's localStorage. */
class LimitedStorage extends MemoryStorage {
  constructor(private limit: number) {
    super();
  }
  set(key: string, value: string) {
    if (value.length > this.limit) return false;
    return super.set(key, value);
  }
}

describe("ConversationsRepository : quota", () => {
  const image = "data:image/png;base64," + "A".repeat(2000);
  const withImage = (id: string): Conversation => ({
    ...conv(id, 1),
    messages: [{ id: "m1", role: "user", content: "vois", createdAt: 1, attachments: [{ name: "a.png", path: "entrees/a.png", kind: "image", size: 10, dataUrl: image }] }],
  });

  test("when space is short, inline images go (the path stays) and the save succeeds", () => {
    const storage = new LimitedStorage(1500);
    const repo = new ConversationsRepository(storage);
    repo.save(withImage("a"));
    const saved = repo.list()[0];
    expect(saved.messages[0].attachments?.[0].dataUrl).toBeUndefined();
    expect(saved.messages[0].attachments?.[0].path).toBe("entrees/a.png");
  });

  test("if even lightened it does not fit: StorageFullError, and nothing is overwritten", () => {
    const storage = new LimitedStorage(200);
    const repo = new ConversationsRepository(storage);
    repo.save(conv("petit", 1));
    expect(() => repo.save({ ...conv("gros", 2), title: "x".repeat(500) })).toThrow(StorageFullError);
    expect(repo.list().map((c) => c.id)).toEqual(["petit"]);
  });
});
