"use client";

import { useSyncExternalStore } from "react";
import type { SlashCommand } from "@/lib/agent/commands";
import { createStore } from "./store";

/* ---------------------------------------------------------------------------
   The commands of the subscription agents, as the composer offers them.

   Two sources: what each external agent publishes when a session opens in
   a neutral folder (the discovery, `/api/acp/models`, per Claude Code /
   Codex…), and what a conversation's live session publishes
   (per BytNode-AI agent: its workspace's skills are commands too — the
   profession's, synced into `.claude/skills`). The live list wins; it is
   kept in the browser, so the composer has it at the first paint after a
   reload, before any session is open.
--------------------------------------------------------------------------- */

type State = {
  /** Per ACP agent id (`claude`, `openai`…): from the discovery. */
  byAcp: Record<string, SlashCommand[]>;
  /** Per BytNode-AI agent id: from its conversations' sessions. */
  byAgent: Record<string, SlashCommand[]>;
};

const CACHE_KEY = "agentchat:agent-commands";

const store = createStore<State>({ byAcp: {}, byAgent: {} }, () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<State>) : null;
    return { byAcp: {}, byAgent: saved && typeof saved.byAgent === "object" && saved.byAgent !== null ? saved.byAgent : {} };
  } catch {
    return { byAcp: {}, byAgent: {} };
  }
});

const remember = (state: State) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ byAgent: state.byAgent }));
  } catch {
    /* full or blocked: the discovery's list serves until the next turn */
  }
};

const same = (a: SlashCommand[] | undefined, b: SlashCommand[]) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** The discovery's lists, per ACP agent. */
export function setDiscoveredCommands(lists: Record<string, SlashCommand[]>): void {
  const current = store.get();
  if (Object.entries(lists).every(([id, list]) => same(current.byAcp[id], list))) return;
  store.set({ ...current, byAcp: { ...current.byAcp, ...lists } });
}

/** A live session's list, for the BytNode-AI agent it belongs to. */
export function setAgentCommands(agentId: string, list: SlashCommand[]): void {
  const current = store.get();
  if (!agentId || same(current.byAgent[agentId], list)) return;
  const next = { ...current, byAgent: { ...current.byAgent, [agentId]: list } };
  store.set(next);
  remember(next);
}

const pick = (state: State, agentId: string | null | undefined, acpId: string | null | undefined): SlashCommand[] =>
  (agentId ? state.byAgent[agentId] : undefined) ?? (acpId ? state.byAcp[acpId] : undefined) ?? NONE;

const NONE: SlashCommand[] = [];

/** An agent's own commands (none for an OpenRouter agent). */
export function useAgentCommands(agentId: string | null | undefined, acpId: string | null | undefined): SlashCommand[] {
  const state = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return acpId ? pick(state, agentId, acpId) : NONE;
}

/** The same, outside React (a message being sent). */
export const agentCommandsNow = (agentId: string | null | undefined, acpId: string | null | undefined): SlashCommand[] =>
  acpId ? pick(store.get(), agentId, acpId) : NONE;
