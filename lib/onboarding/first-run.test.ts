import { describe, expect, it } from "vitest";
import { loadLocale } from "@/lib/i18n/store";
import { FIRST_AGENT_NAME, FIRST_KEY_VENDOR, firstAgent, firstAgentProvider, welcomeConversation } from "./first-run";

describe("the first launch ends in the app", () => {
  it("the first agent runs on the first subscription signed in, in the cards' order", () => {
    expect(firstAgentProvider(["grok", "openai"], "")).toBe("acp:openai");
    expect(firstAgentProvider(["claude"], "sk-or-x")).toBe("acp:claude");
  });

  it("otherwise on the OpenRouter key", () => {
    expect(firstAgentProvider([], "sk-or-x")).toBe(FIRST_KEY_VENDOR);
  });

  it("is named after the app, with the default profession and its own folder", () => {
    const a = firstAgent("acp:claude");
    expect(a.name).toBe(FIRST_AGENT_NAME);
    expect(a.providerId).toBe("acp:claude");
    expect(a.workspace).toBe("");
  });

  it("opens on a welcome from the agent, by first name", () => {
    const agent = { ...firstAgent("acp:claude"), id: "a1" };
    const c = welcomeConversation(agent, { firstName: " Ada ", lastName: "", email: "", bio: "" }, "c1", 5);
    expect(c.agentId).toBe("a1");
    expect(c.modelId).toBe("");
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].role).toBe("assistant");
    expect(c.messages[0].content.startsWith("Hi Ada, I'm your first agent.")).toBe(true);
    /* Played once by the thread, as if written live. */
    expect(c.messages[0].intro).toBe(true);
    expect(welcomeConversation(agent, { firstName: "", lastName: "", email: "", bio: "" }, "c2", 5).messages[0].content.startsWith("Hi, I'm")).toBe(true);
  });

  it("is written in the language chosen when the setup ends, as markdown", async () => {
    const agent = { ...firstAgent("acp:claude"), id: "a1" };
    const ada = { firstName: "Ada", lastName: "", email: "", bio: "" };
    try {
      await loadLocale("fr");
      const c = welcomeConversation(agent, ada, "c3", 5);
      expect(c.title).toBe("Bienvenue dans BytNode-AI");
      expect(c.messages[0].content.startsWith("Bonjour Ada, je suis votre premier agent.")).toBe(true);
      expect(c.messages[0].content).toContain("\n- **Lire le marché en direct**");
    } finally {
      await loadLocale("en");
    }
    expect(welcomeConversation(agent, ada, "c4", 5).title).toBe("Welcome to BytNode-AI");
  });
});
