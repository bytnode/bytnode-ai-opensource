"use client";

import { useSyncExternalStore } from "react";
import type { Conversation, Message } from "@/lib/domain/types";
import { CONVERSATIONS_KEY, ConversationsRepository, StorageFullError } from "@/lib/storage/repositories";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";
import { onStorageChange } from "./sync";

const repo = new ConversationsRepository(new BrowserStorage());

/* ⚠️ SOME CONVERSATIONS ARE AHEAD OF STORAGE, AND A RE-READ MUST NOT DROP
   THEM. The one a turn is streaming into is patched per frame and written
   only at the end; one whose save did not fit (quota) exists only here.
   Every re-read of storage — after a delete, a save of another
   conversation, another tab's change — lays these over what is stored:
   deleting an old conversation to make room used to roll the unsaved turn
   back on screen. */
const ahead = new Map<string, Conversation>();
/** Of those, the ones whose save failed: retried when room is made. */
const failed = new Set<string>();

function current(): Conversation[] {
  const list = repo.list();
  if (ahead.size === 0) return list;
  const byId = new Map(list.map((c) => [c.id, c]));
  for (const [id, c] of ahead) byId.set(id, c);
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

const store = createStore<Conversation[]>([], () => {
  /* Another tab saved a turn or deleted a conversation: take it, keeping
     what is ahead here (a turn in progress in THIS tab). */
  onStorageChange(CONVERSATIONS_KEY, () => store.set(current()));
  return current();
});

/** True when the last save did not fit in storage: the thread shows what
    happened, but a reload would lose it. */
const full = createStore<boolean>(false);

export function useConversations(): Conversation[] {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function useStorageFull(): boolean {
  return useSyncExternalStore(full.subscribe, full.get, full.getServer);
}

/** Writes one conversation; false (and kept in memory) if it does not fit. */
function write(conversation: Conversation): boolean {
  try {
    repo.save(conversation);
    ahead.delete(conversation.id);
    failed.delete(conversation.id);
    return true;
  } catch (e) {
    if (!(e instanceof StorageFullError)) throw e;
    ahead.set(conversation.id, conversation);
    failed.add(conversation.id);
    return false;
  }
}

/** Room was made: the conversations that did not fit are written again. */
function retryFailed() {
  for (const id of [...failed]) {
    const c = ahead.get(id);
    if (c) write(c);
    else failed.delete(id);
  }
}

export function saveConversation(conversation: Conversation) {
  store.get(); // the first read (and the other tabs' listener) before any write
  /* Not written, but not lost on screen: the conversation stays ahead of
     storage, and the thread gives notice. */
  write(conversation);
  full.set(failed.size > 0);
  store.set(current());
}

export function renameConversation(id: string, title: string) {
  const c = getConversation(id);
  const t = title.trim();
  if (!c || !t || t === c.title) return;
  saveConversation({ ...c, title: t });
}

export function removeConversation(id: string) {
  store.get();
  ahead.delete(id);
  failed.delete(id);
  repo.remove(id);
  retryFailed();
  full.set(failed.size > 0);
  store.set(current());
}

/** A removed agent takes its conversations with it: they no longer have a
    context or a provider to continue with. */
export function removeConversationsOfAgent(agentId: string) {
  store.get();
  for (const [id, c] of ahead) {
    if (c.agentId !== agentId) continue;
    ahead.delete(id);
    failed.delete(id);
  }
  for (const c of repo.list()) if (c.agentId === agentId) repo.remove(c.id);
  retryFailed();
  full.set(failed.size > 0);
  store.set(current());
}

/** Replaces the last message of a conversation (the one filling up during a
    stream) without re-reading the repository at every delta: persistence
    only happens at the end — until then the conversation is ahead of
    storage. */
export function patchLastMessage(id: string, patch: (m: Message) => Message) {
  store.set((list) =>
    list.map((c) => {
      if (c.id !== id || c.messages.length === 0) return c;
      const messages = c.messages.slice();
      messages[messages.length - 1] = patch(messages[messages.length - 1]);
      const next = { ...c, messages };
      ahead.set(id, next);
      return next;
    }),
  );
}

export function getConversation(id: string): Conversation | undefined {
  return store.get().find((c) => c.id === id);
}
