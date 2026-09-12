import { describe, expect, test } from "vitest";
import { MemoryStorage } from "./storage";
import { ConversationsRepository, LEGACY_AGENT_ID, SettingsRepository, defaultSettings } from "./repositories";
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
    expect(loaded.version).toBe(2);
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]).toMatchObject({ id: LEGACY_AGENT_ID, name: "Nova", providerId: "anthropic", contextText: "ctx" });
    expect(loaded.activeAgentId).toBe(LEGACY_AGENT_ID);
  });

  test("keeps a v2 agents list and its active id", () => {
    const repo = new SettingsRepository(new MemoryStorage());
    const s = {
      ...defaultSettings(),
      agents: [
        { id: "a", name: "A", profession: "standard" as const, providerId: "openai", defaultModelId: null, defaultEffort: null, workspace: "", permissionMode: "ask" as const, scope: "workspace" as const, contextText: "", contextFiles: [], createdAt: 1 },
        { id: "b", name: "B", profession: "quantitatif" as const, providerId: "google", defaultModelId: null, defaultEffort: "high", workspace: "C:/proj", permissionMode: "skip" as const, scope: "disk" as const, contextText: "", contextFiles: [], createdAt: 2 },
      ],
      activeAgentId: "b",
    };
    repo.save(s);
    expect(repo.load()).toEqual(s);
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
