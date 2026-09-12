"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "@/lib/state/store";
import { ACP_AGENTS, type AcpAgentId, type AcpAuthStatus } from "./agents";

/* L'etat des comptes par abonnement, partage par tous les composants qui
   l'affichent. Pendant une connexion, on relit toutes les deux secondes
   jusqu'a ce que l'agent dise « connecté » (ou qu'on renonce). */

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
      if (!res.ok || !json.agents) throw new Error(json.error?.message ?? "État des abonnements indisponible.");
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
}

export function useAcpAuth(): AcpAuth {
  const auth = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  useEffect(() => {
    if (store.get().status === "idle") void loadAcpAuth();
  }, []);
  return auth;
}

/** Appele quand un agent passe a « connecté » : le catalogue de modeles
    doit alors l'interroger. */
export function onAcpAuthChange(listener: (agents: AcpAuthStatus[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function acpLogin(agent: AcpAgentId): Promise<string | null> {
  const res = await fetch("/api/acp/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, action: "login" }) });
  const json = (await res.json()) as { status?: AcpAuthStatus; error?: { message?: string } };
  if (!res.ok) return json.error?.message ?? "Connexion impossible.";
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
  if (!res.ok) return json.error?.message ?? "Installation impossible.";
  if (json.status) {
    const agents = store.get().agents.map((a) => (a.agent === agent ? { ...json.status!, installing: !json.status!.available } : a));
    store.set({ status: "ready", agents });
    schedulePoll(agents);
  }
  return null;
}

export async function acpLogout(agent: AcpAgentId): Promise<void> {
  await fetch("/api/acp/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, action: "logout" }) }).catch(() => {});
  await loadAcpAuth();
}

export const isLoggedIn = (auth: AcpAuth, agent: AcpAgentId) => auth.agents.find((a) => a.agent === agent)?.loggedIn === true;
