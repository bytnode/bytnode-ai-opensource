import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "./prompt";
import type { AgentConfig, Profile } from "@/lib/domain/types";

const profile: Profile = { firstName: "Olivier", lastName: "Fremont", email: "", bio: "" };
const agent = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "a1",
  createdAt: 0,
  name: "Nova",
  profession: "standard",
  providerId: "anthropic",
  defaultModelId: null,
  contextText: "",
  contextFiles: [],
  ...over,
});

describe("buildSystemPrompt", () => {
  test("names the agent and the user", () => {
    const out = buildSystemPrompt(profile, agent());
    expect(out).toContain("Nova");
    expect(out).toContain("Olivier Fremont");
  });

  test("includes the free-text context when present", () => {
    const out = buildSystemPrompt(profile, agent({ contextText: "Tu parles toujours en français." }));
    expect(out).toContain("Tu parles toujours en français.");
  });

  test("includes each file under its name", () => {
    const out = buildSystemPrompt(
      profile,
      agent({ contextFiles: [{ id: "1", name: "notes.md", size: 10, content: "# Notes\nhello" }] }),
    );
    expect(out).toContain("notes.md");
    expect(out).toContain("# Notes\nhello");
  });

  test("omits the context sections entirely when there is nothing to say", () => {
    const out = buildSystemPrompt(profile, agent());
    expect(out).not.toMatch(/contexte/i);
    expect(out).not.toMatch(/fichier/i);
  });

  test("includes the user's own description when given", () => {
    const out = buildSystemPrompt({ ...profile, bio: "Trader crypto, basé à Lyon." }, agent());
    expect(out).toContain("Trader crypto, basé à Lyon.");
    expect(buildSystemPrompt(profile, agent())).not.toMatch(/propos/i);
  });

  test("copes with an unnamed user", () => {
    const out = buildSystemPrompt({ firstName: "", lastName: "", email: "", bio: "" }, agent());
    expect(out).toContain("Nova");
    expect(out).not.toMatch(/\s{2,}\./);
  });
});
