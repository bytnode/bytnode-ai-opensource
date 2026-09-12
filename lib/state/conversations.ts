"use client";

import { useSyncExternalStore } from "react";
import type { Conversation, Message } from "@/lib/domain/types";
import { ConversationsRepository } from "@/lib/storage/repositories";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

const repo = new ConversationsRepository(new BrowserStorage());

const store = createStore<Conversation[]>([], () => repo.list());

export function useConversations(): Conversation[] {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function saveConversation(conversation: Conversation) {
  repo.save(conversation);
  store.set(repo.list());
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

/** Un agent supprime emporte ses conversations : elles n'ont plus de
    contexte ni de fournisseur pour continuer. */
export function removeConversationsOfAgent(agentId: string) {
  for (const c of repo.list()) if (c.agentId === agentId) repo.remove(c.id);
  store.set(repo.list());
}

/** Remplace le dernier message d'une conversation (celui qui se remplit
    pendant un flux) sans relire le depot a chaque delta : la persistance
    n'a lieu qu'a la fin. */
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
