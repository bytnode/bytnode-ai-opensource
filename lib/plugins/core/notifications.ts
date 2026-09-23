import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppNotification } from "@/lib/domain/plugins";
import { dataDir } from "@/lib/server/data-dir";
import type { NotificationInput } from "./contract";
import { readJson, updateJson } from "./store";

/* ---------------------------------------------------------------------------
   The notification center: what the background has to say.

   An alert that fired, a DCA purchase to confirm, a scheduled task that
   finished — written to `~/.bytnode-ai/notifications.json` (newest first,
   bounded) by whichever process produced it, read by the tab bar's bell,
   which also raises a browser notification when a tab is open.
--------------------------------------------------------------------------- */

export const MAX_NOTIFICATIONS = 200;

const file = () => path.join(dataDir(), "notifications.json");

/** Newest first, bounded. Pure. */
export const pushNotification = (list: AppNotification[], n: AppNotification, max = MAX_NOTIFICATIONS): AppNotification[] => [n, ...list].slice(0, max);

/** Marks as read these ids, or all. Pure. */
export const markRead = (list: AppNotification[], ids: string[] | "all"): AppNotification[] =>
  list.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n));

export async function addNotification(plugin: string, input: NotificationInput): Promise<AppNotification> {
  const n: AppNotification = { id: randomUUID(), at: Date.now(), plugin, title: input.title, body: input.body, level: input.level ?? "info", read: false, ...(input.action ? { action: input.action } : {}) };
  await updateJson<AppNotification[]>(file(), [], (list) => pushNotification(list, n));
  return n;
}

export const listNotifications = (): Promise<AppNotification[]> => readJson<AppNotification[]>(file(), []);

export async function readNotifications(ids: string[] | "all"): Promise<void> {
  await updateJson<AppNotification[]>(file(), [], (list) => markRead(list, ids));
}

export async function removeNotifications(ids: string[] | "all"): Promise<void> {
  await updateJson<AppNotification[]>(file(), [], (list) => (ids === "all" ? [] : list.filter((n) => !ids.includes(n.id))));
}

/** The notifications that point at a confirmation: read once it is decided. */
export async function readConfirmationNotices(confirmationId: string): Promise<void> {
  await updateJson<AppNotification[]>(file(), [], (list) =>
    list.map((n) => (n.action?.kind === "confirm" && n.action.confirmationId === confirmationId ? { ...n, read: true } : n)),
  );
}
