import type { AcpAgentId } from "@/lib/acp/agents";
import { ACP_AGENTS } from "@/lib/acp/agents";
import type { AgentConfig, Conversation, Profile } from "@/lib/domain/types";
import { blankAgent } from "@/lib/storage/repositories";
import { currentMessages } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   The first launch ends in the app, not in a form (user request,
   2026-10-09: « quand l'authentification est finie, je ne veux pas qu'on
   ait à créer un agent … directement sur la page d'accueil … avec un
   welcome »).

   So the wizard stops after the models, and the app makes the first agent
   itself — on the subscription the user just connected, otherwise on their
   OpenRouter key — and opens a first conversation where that agent says
   hello and what it can do. Pure, tested.
--------------------------------------------------------------------------- */

/** The first agent's name: the app's own, until the user renames it. */
export const FIRST_AGENT_NAME = "BytNode-AI";

/** The vendor a first agent on an OpenRouter key starts with. */
export const FIRST_KEY_VENDOR = "anthropic";

/** Which provider the first agent runs on: the first subscription signed
    in, in the cards' order; otherwise the OpenRouter key. */
export function firstAgentProvider(signedIn: AcpAgentId[], openrouterKey: string): string {
  const sub = ACP_AGENTS.find((a) => signedIn.includes(a.id));
  if (sub) return sub.providerId;
  return openrouterKey.trim() ? FIRST_KEY_VENDOR : (ACP_AGENTS[0]?.providerId ?? FIRST_KEY_VENDOR);
}

/** The first agent: the default profession, its own folder. Its id and
    date are set by the caller, at creation. */
export function firstAgent(providerId: string): AgentConfig {
  return { ...blankAgent(), name: FIRST_AGENT_NAME, providerId };
}

/** The first conversation: the agent's welcome, already in the thread. Its
    model is left to the agent's default (`modelId` empty: the chat picks
    the provider's newest, `chat-shell.tsx`). Written in the interface's
    language at the moment the setup ends: it is the user's first read, and
    the agent answers in whatever language the user then writes in. */
export function welcomeConversation(agent: AgentConfig, profile: Profile, id: string, now: number): Conversation {
  const who = profile.firstName.trim();
  const w = currentMessages().onboarding.welcome;
  const content = [
    w.hello(who),
    "",
    `**${w.canDoTitle}**`,
    "",
    `- ${w.canDoMarket}`,
    `- ${w.canDoBuild}`,
    `- ${w.canDoAccounts}`,
    `- ${w.canDoAway}`,
    "",
    `**${w.yoursTitle}**`,
    "",
    w.yours,
    "",
    `**${w.tryTitle}**`,
    "",
    `- ${w.tryMoving}`,
    `- ${w.tryChart}`,
    `- ${w.tryBacktest}`,
  ].join("\n");
  return {
    id,
    agentId: agent.id,
    title: w.title,
    modelId: "",
    createdAt: now,
    updatedAt: now,
    messages: [{ id: `${id}-welcome`, role: "assistant", content, createdAt: now, intro: true }],
  };
}
