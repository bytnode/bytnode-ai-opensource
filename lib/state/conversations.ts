"use client";

import { useSyncExternalStore } from "react";
import type { Conversation, Message } from "@/lib/domain/types";
import { ConversationsRepository, StorageFullError } from "@/lib/storage/repositories";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

const repo = new ConversationsRepository(new BrowserStorage());

const store = createStore<Conversation[]>([], () => repo.list());

/** True when the last save did not fit in storage: the thread shows what
    happened, but a reload would lose it. */
const full = createStore<boolean>(false);

export function useConversations(): Conversation[] {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function useStorageFull(): boolean {
  return useSyncExternalStore(full.subscribe, full.get, full.getServer);
}

export function saveConversation(conversation: Conversation) {
  try {
    repo.save(conversation);
    full.set(false);
    store.set(repo.list());
  } catch (e) {
    if (!(e instanceof StorageFullError)) throw e;
    /* Not written, but not lost on screen: the in-memory list takes the
       conversation as is, and the thread gives notice. */
    full.set(true);
    store.set((list) => [conversation, ...list.filter((c) => c.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }
}

export function renameConversation(id: string, title: string) {
  const c = getConversation(id);
  const t = title.trim();
  if (!c || !t || t === c.title) return;
  saveConversation({ ...c, title: t });
}

export function removeConversation(id: string) {
  repo.remove(id);
  store.set(repo.list());
}

/** A removed agent takes its conversations with it: they no longer have a
    context or a provider to continue with. */
export function removeConversationsOfAgent(agentId: string) {
  for (const c of repo.list()) if (c.agentId === agentId) repo.remove(c.id);
  store.set(repo.list());
}

/** Replaces the last message of a conversation (the one filling up during a
    stream) without re-reading the repository at every delta: persistence
    only happens at the end. */
export function patchLastMessage(id: string, patch: (m: Message) => Message) {
  store.set((list) =>
    list.map((c) => {
      if (c.id !== id || c.messages.length === 0) return c;
      const messages = c.messages.slice();
      messages[messages.length - 1] = patch(messages[messages.length - 1]);
      return { ...c, messages };
    }),
  );
}

export function getConversation(id: string): Conversation | undefined {
  return store.get().find((c) => c.id === id);
}
