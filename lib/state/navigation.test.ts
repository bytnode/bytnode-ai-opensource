import { beforeEach, expect, it, vi } from "vitest";
import type { AgentConfig, Conversation } from "@/lib/domain/types";
import { blankAgent } from "@/lib/storage/repositories";

const data = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
};

const agent = (id: string, name: string): AgentConfig => ({ ...blankAgent(), id, name, providerId: "openai", createdAt: 1 });
const conv = (id: string, agentId: string): Conversation => ({ id, agentId, title: id, modelId: "m", createdAt: 1, updatedAt: 1, messages: [] });

beforeEach(() => {
  data.clear();
  vi.resetModules();
});

it("opening another agent's conversation makes THAT agent the active one", async () => {
  const { updateSettings, currentSettings } = await import("./settings");
  const { saveConversation } = await import("./conversations");
  const { openConversation, useNavigation } = await import("./navigation");
  void useNavigation;
  updateSettings((s) => ({ ...s, agents: [agent("nova", "Nova"), agent("orion", "Orion")], activeAgentId: "orion" }));
  saveConversation(conv("c-nova", "nova"));
  openConversation("c-nova");
  expect(currentSettings().activeAgentId).toBe("nova");
});

it("a conversation whose agent no longer exists opens without touching the active agent", async () => {
  const { updateSettings, currentSettings } = await import("./settings");
  const { saveConversation } = await import("./conversations");
  const { openConversation, goToConversation } = await import("./navigation");
  updateSettings((s) => ({ ...s, agents: [agent("orion", "Orion")], activeAgentId: "orion" }));
  saveConversation(conv("c-gone", "gone"));
  openConversation("c-gone");
  expect(currentSettings().activeAgentId).toBe("orion");
  /* From a notification or a plugin's tab: the same rule. */
  updateSettings((s) => ({ ...s, agents: [...s.agents, agent("nova", "Nova")] }));
  saveConversation(conv("c-nova", "nova"));
  goToConversation("c-nova");
  expect(currentSettings().activeAgentId).toBe("nova");
});
