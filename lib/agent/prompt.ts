import type { AgentConfig, Profile } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   The system prompt: the agent's identity, then what the user entrusted to
   it. Each section only appears if it has something to say — a « Context »
   heading followed by nothing teaches the model that there is no context,
   which is not the same as saying nothing.

   ⚠️ THIS IS WHERE THE TOOLS WILL ANNOUNCE THEMSELVES LATER. The function
   takes the whole configuration so that adding a section does not change
   its signature.
--------------------------------------------------------------------------- */

const fullName = (p: Profile) => [p.firstName, p.lastName].map((s) => s.trim()).filter(Boolean).join(" ");

export function buildSystemPrompt(profile: Profile, agent: AgentConfig): string {
  const name = agent.name.trim() || "Assistant";
  const user = fullName(profile);
  const parts: string[] = [];

  parts.push(
    `You are ${name}, a conversational assistant.` +
      (user ? ` You are talking with ${user}.` : "") +
      " Answer precisely and without filler. Always answer in the language the user writes in.",
  );

  const bio = profile.bio.trim();
  if (bio) parts.push(`## About ${user || "the user"}\n\n${bio}`);

  const context = agent.contextText.trim();
  if (context) parts.push(`## Context provided by the user\n\n${context}`);

  if (agent.contextFiles.length > 0) {
    const files = agent.contextFiles
      .map((f) => `### File: ${f.name}\n\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
    parts.push(`## Reference files\n\n${files}`);
  }

  return parts.join("\n\n");
}
