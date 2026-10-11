"use client";

import { useSyncExternalStore } from "react";
import { getConversation } from "./conversations";
import { currentSettings, updateSettings } from "./settings";
import { createStore } from "./store";
import { HOME, activateTab } from "./tabs";

/* ---------------------------------------------------------------------------
   Where the user is in the home tab: the open conversation, and the
   settings panel if it is open. Held here rather than inside the chat so
   that a notification ("your morning brief is ready") or a plugin's tab
   ("add an exchange account") can take the user there. In memory only:
   a reload starts on a new conversation, as before.
--------------------------------------------------------------------------- */

/** The settings panel's target: a tab and, for Agents, an agent id, `new`
    or nothing (the list). The agent itself is looked up by the panel. */
export type SettingsRequest = { tab: "general" | "auth" | "agents" | "providers" | "plugins"; agentId?: string | "new"; plugin?: string };

/** `agentPage`: the agent whose page is open (its conversations,
    instructions, context and scheduled tasks) instead of a thread. */
type Navigation = { conversation: string | null; agentPage: string | null; settings: SettingsRequest | null };

const store = createStore<Navigation>({ conversation: null, agentPage: null, settings: null });

export const useNavigation = (): Navigation => useSyncExternalStore(store.subscribe, store.get, store.getServer);

/** A thread — an existing one, or a new one (`null`) — replaces the agent's
    page. */
export const setActiveConversation = (conversation: string | null) => store.set((n) => ({ ...n, conversation, agentPage: null }));

/** Opens an agent's page AND makes it the active agent: the page's
    composer starts a conversation with it. */
export function openAgentPage(agentId: string) {
  const s = currentSettings();
  if (s.activeAgentId !== agentId && s.agents.some((a) => a.id === agentId)) updateSettings((p) => ({ ...p, activeAgentId: agentId }));
  store.set((n) => ({ ...n, conversation: null, agentPage: agentId }));
}

/** Opens a conversation AND makes its agent the active one.
    ⚠️ The thread runs with the ACTIVE agent's prompt, tools, workspace and
    permissions: opening another agent's conversation without switching
    had that agent's thread answered by the wrong one (and its earlier
    replies labelled with the wrong name). */
export function openConversation(id: string) {
  const c = getConversation(id);
  if (c) {
    const s = currentSettings();
    if (s.activeAgentId !== c.agentId && s.agents.some((a) => a.id === c.agentId)) updateSettings((p) => ({ ...p, activeAgentId: c.agentId }));
  }
  setActiveConversation(id);
}

export const openSettings = (settings: SettingsRequest | null) => store.set((n) => ({ ...n, settings }));

/** From anywhere: back to the conversations, on this one. */
export function goToConversation(conversation: string) {
  openConversation(conversation);
  activateTab(HOME);
}

/** From anywhere: back to the conversations, settings open. */
export function goToSettings(settings: SettingsRequest) {
  openSettings(settings);
  activateTab(HOME);
}
