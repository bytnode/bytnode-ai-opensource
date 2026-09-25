"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "@/lib/state/store";
import { ACP_AGENTS, type AcpAgentId, type AcpAuthStatus } from "./agents";

/* The state of the subscription accounts, shared by every component that
   displays it. During a sign-in, we re-read every two seconds until the
   agent says « signed in » (or we give up). */

export type AcpAuth = { status: "idle" | "loading" | "ready" | "error"; agents: AcpAuthStatus[]; message?: string };

const initial: AcpAuthStatus[] = ACP_AGENTS.map((a) => ({ agent: a.id, available: false, loggedIn: false }));
const store = createStore<AcpAuth>({ status: "idle", agents: initial });

let inflight: Promise<void> | null = null;
let poll: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(agents: AcpAuthStatus[]) => void>();

export function loadAcpAuth(): Promise<void> {
  if (inflight) return inflight;
  const current = store.get();
  if (current.status === "idle") store.set({ ...current, status: "loading" });
  inflight = (async () => {
    try {
      const res = await fetch("/api/acp/auth");
      const json = (await res.json()) as { agents?: AcpAuthStatus[]; error?: { message?: string } };
      if (!res.ok || !json.agents) throw new Error(json.error?.message ?? "Subscription status unavailable.");
      store.set({ status: "ready", agents: json.agents });
      for (const l of listeners) l(json.agents);
      schedulePoll(json.agents);
    } catch (e) {
      store.set({ status: "error", agents: store.get().agents, message: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function schedulePoll(agents: AcpAuthStatus[]) {
  if (poll) clearTimeout(poll);
  poll = null;
  if (agents.some((a) => a.connecting || a.installing || a.checking)) poll = setTimeout(() => void loadAcpAuth(), 2000);
  /* An update waiting for its agent to be idle starts on the server on its
     own: a slower read notices it, and the catalog then takes the new models. */
  else if (agents.some((a) => a.outdated)) poll = setTimeout(() => void loadAcpAuth(), 60_000);
}

export function useAcpAuth(): AcpAuth {
  const auth = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  useEffect(() => {
    if (store.get().status === "idle") void loadAcpAuth();
  }, []);
  return auth;
}

/** Called when an agent flips to « signed in »: the model catalog must
    then query it. */
export function onAcpAuthChange(listener: (agents: AcpAuthStatus[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function acpLogin(agent: AcpAgentId): Promise<string | null> {
  const res = await fetch("/api/acp/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, action: "login" }) });
  const json = (await res.json()) as { status?: AcpAuthStatus; error?: { message?: string } };
  if (!res.ok) return json.error?.message ?? "Could not sign in.";
  if (json.status) {
    const agents = store.get().agents.map((a) => (a.agent === agent ? { ...json.status!, connecting: !json.status!.loggedIn } : a));
    store.set({ status: "ready", agents });
    schedulePoll(agents);
  }
  return null;
}

export async function acpInstall(agent: AcpAgentId): Promise<string | null> {
  const res = await fetch("/api/acp/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, action: "install" }) });
  const json = (await res.json()) as { status?: AcpAuthStatus; error?: { message?: string } };
  if (!res.ok) return json.error?.message ?? "Could not install.";
  if (json.status) {
    const agents = store.get().agents.map((a) => (a.agent === agent ? { ...json.status!, installing: true } : a));
    store.set({ status: "ready", agents });
    schedulePoll(agents);
  }
  return null;
}

/** Returns the reason the sign-out failed, or null. ⚠️ It used to swallow
    everything and return void, so a refusal from the agent reached nobody:
    the button simply came back. `loadAcpAuth` still runs either way — a
    partial sign-out must not leave a stale state on screen. */
export async function acpLogout(agent: AcpAgentId): Promise<string | null> {
  let message: string | null = null;
  try {
    const res = await fetch("/api/acp/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, action: "logout" }) });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) message = json.error?.message ?? "Could not sign out.";
  } catch {
    message = "Could not sign out.";
  }
  await loadAcpAuth();
  return message;
}

export const isLoggedIn = (auth: AcpAuth, agent: AcpAgentId) => auth.agents.find((a) => a.agent === agent)?.loggedIn === true;
