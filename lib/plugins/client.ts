"use client";

import type { AppNotification, Confirmation, PluginStatus } from "@/lib/domain/plugins";
import type { ToolPolicy } from "@/lib/tools/types";
import type { Settings } from "@/lib/domain/types";
import { transportHeaders, type Transport } from "@/lib/tools/transport";
import { ACCOUNT_STORAGE_KEY } from "@/lib/account/browser";
import type { UserPluginInfo } from "./user/types";

/* ---------------------------------------------------------------------------
   The plugins, seen from the browser: every call to the server's plugin
   routes goes through here.
--------------------------------------------------------------------------- */

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !body) throw new Error(body?.error?.message ?? `The server answered ${res.status}.`);
  return body;
}

/** What the agent's plugins add to its prompt, for this turn. Never
    blocking: without an answer, nothing is added. */
export async function fetchPluginPrompt(agentId: string, engine: "native" | "mcp", transport: Transport): Promise<string> {
  try {
    const res = await fetch(`/api/plugins/prompt?agentId=${encodeURIComponent(agentId)}&engine=${engine}`, { headers: transportHeaders({ ...transport, openrouterKey: "" }) });
    return (await json<{ prompt: string }>(res)).prompt;
  } catch {
    return "";
  }
}

export type PluginToolInfo = { plugin: string; name: string; description: string; policy: ToolPolicy };

export const fetchPlugins = async (): Promise<{ status: PluginStatus[]; tools: PluginToolInfo[] }> => json(await fetch("/api/plugins"));

/** A view's action: `POST /api/plugins/<id>/<action>`. */
export async function callPlugin<T>(id: string, action: string, params: Record<string, unknown>, transport: Partial<Transport> = {}): Promise<T> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
    body: JSON.stringify(params),
  });
  return (await json<{ result: T }>(res)).result;
}

export const clearPluginData = async (id: string): Promise<void> => void (await json(await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" })));

/** The open tab speaks: the settings (keys included) for the background.
    Answers where each plugin stands. */
/** The browser's approval key (`lib/plugins/user/approval.ts`): 32 random
    bytes made once and kept in this browser only. It proves to the server
    that an approval comes from the user's own tab — an agent's script does
    not have it. `null` when storage is unavailable (nothing can be approved
    then, which is the safe side). */
const APPROVAL_KEY = "agentchat:approval-key";
export function browserApprovalKey(): string | null {
  try {
    let key = localStorage.getItem(APPROVAL_KEY);
    if (!key || !/^[0-9a-f]{64}$/.test(key)) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(APPROVAL_KEY, key);
    }
    return key;
  } catch {
    return null;
  }
}

const approvalHeader = (): Record<string, string> => {
  const key = browserApprovalKey();
  return key ? { "x-bytnode-approval": key } : {};
};

/** The BytNode account session this browser keeps (`lib/account/browser.ts`):
    the server derives the app's BytNode credential from it. */
const accountHeader = (): Record<string, string> => {
  try {
    const token = (JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) ?? "null") as { token?: unknown } | null)?.token;
    return typeof token === "string" && token.startsWith("bnd_") ? { "x-bytnode-session": token } : {};
  } catch {
    return {};
  }
};

export async function syncSession(settings: Settings): Promise<PluginStatus[]> {
  const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json", ...approvalHeader(), ...accountHeader() }, body: JSON.stringify(settings) });
  return (await json<{ status: PluginStatus[] }>(res)).status;
}

export const fetchNotifications = async (): Promise<AppNotification[]> => (await json<{ notifications: AppNotification[] }>(await fetch("/api/notifications"))).notifications;

export async function updateNotifications(change: { read?: string[] | "all"; remove?: string[] | "all" }): Promise<AppNotification[]> {
  const res = await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  return (await json<{ notifications: AppNotification[] }>(res)).notifications;
}

export const fetchConfirmations = async (): Promise<Confirmation[]> => (await json<{ confirmations: Confirmation[] }>(await fetch("/api/confirmations"))).confirmations;

/** The user's decision on a parked call; the targeted account travels like
    any tool request's. */
export async function decideConfirmation(id: string, allow: boolean, transport: Partial<Transport>): Promise<Confirmation> {
  const res = await fetch(`/api/confirmations/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
    body: JSON.stringify({ allow }),
  });
  return (await json<{ confirmation: Confirmation }>(res)).confirmation;
}

/* --- The plugins written by agents ---------------------------------------- */

export const fetchUserPlugins = async (): Promise<UserPluginInfo[]> => (await json<{ plugins: UserPluginInfo[] }>(await fetch("/api/user-plugins"))).plugins;

/** The user's decision on a plugin's permissions; `digest`: the version
    the review screen showed. */
export async function decideUserPlugin(id: string, digest: string, allow: boolean, accounts: string[]): Promise<void> {
  const res = await fetch(`/api/user-plugins/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...approvalHeader() },
    body: JSON.stringify({ digest, allow, accounts }),
  });
  await json(res);
}

export async function revokeUserPlugin(id: string): Promise<void> {
  await json(await fetch(`/api/user-plugins/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke" }) }));
}

export async function deleteUserPlugin(id: string, withData: boolean): Promise<void> {
  await json(await fetch(`/api/user-plugins/${encodeURIComponent(id)}${withData ? "?data=1" : ""}`, { method: "DELETE" }));
}

/** What a plugin's page reported (an exception): kept for its agent. */
export function reportViewError(id: string, message: string): void {
  void fetch(`/api/user-plugins/${encodeURIComponent(id)}/log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) }).catch(() => {});
}
