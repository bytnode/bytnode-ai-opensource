"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Model, Provider } from "@/lib/domain/types";
import type { SlashCommand } from "@/lib/agent/commands";
import { setDiscoveredCommands } from "@/lib/state/agent-commands";
import { createStore } from "@/lib/state/store";
import { isAcpProvider } from "@/lib/acp/agents";
import { currentMessages } from "@/lib/i18n/store";
import type { AgentModes } from "@/lib/acp/translate";
import { onAcpAuthChange } from "@/lib/acp/use-auth";
import { listProviders } from "./catalog";

/* The catalog is read once for the whole session, however many components
   consult it.

   Two sources, merged into the same list: OpenRouter (thousands of models,
   no key required for the list) and the connected subscription agents (a
   few models each, ids `acp:<agent>/…`). The second is read again when a
   subscription connects. */

type Base = {
  models: Model[];
  providers: Provider[];
  /** The modes published by each subscription agent. */
  acpModes: Record<string, AgentModes>;
  /** A read of the subscription models is in flight or still to be
      replayed: an `acp:` provider without a model is not yet « without a
      model ». */
  acpLoading: boolean;
};

export type Catalog =
  | ({ status: "idle" | "loading" } & Base)
  | ({ status: "ready" } & Base)
  | ({ status: "error"; message: string } & Base);

const store = createStore<Catalog>({ status: "idle", models: [], providers: [], acpModes: {}, acpLoading: false });

/** The catalog as it is, outside rendering. */
export const getCatalog = (): Catalog => store.get();

let inflight: Promise<void> | null = null;
let acpInflight: Promise<void> | null = null;
/* The re-read to replay after the one in flight, and whether it must force. */
let acpQueued: Promise<void> | null = null;
let acpQueuedForce = false;

const merge = (openrouter: Model[], acp: Model[]) => [...acp, ...openrouter];

export function loadCatalog(force = false): Promise<void> {
  const current = store.get();
  if (!force && (current.status === "ready" || inflight)) return inflight ?? Promise.resolve();
  store.set({ ...current, status: "loading" });
  inflight = (async () => {
    try {
      const res = await fetch("/api/openrouter/models");
      const json = (await res.json()) as { models?: Model[]; error?: { message?: string } };
      if (!res.ok || !json.models) throw new Error(json.error?.message ?? currentMessages().chat.errors.catalogUnavailable);
      const acp = store.get().models.filter((m) => isAcpProvider(m.providerId));
      const models = merge(json.models, acp);
      store.set({ ...store.get(), status: "ready", models, providers: listProviders(models) });
    } catch (e) {
      const message = e instanceof Error ? e.message : currentMessages().chat.errors.catalogUnavailable;
      const acp = store.get().models.filter((m) => isAcpProvider(m.providerId));
      store.set({ ...store.get(), status: "error", models: acp, providers: listProviders(acp), message });
    } finally {
      inflight = null;
    }
  })();
  void loadAcpModels();
  return inflight;
}

/** The models of the connected subscriptions, merged into the catalog.

    ⚠️ A CALL WHILE A READ IS IN FLIGHT IS NOT LOST. The in-flight response
    was computed BEFORE what motivates the call — typically an agent probed
    through the protocol (Grok, Copilot, Mistral) that just switched to
    « connected » while the first read, slow at startup, has the others
    publish their models. Returning it as is would leave the connected
    agent without any model until the next reload. So a read is replayed
    as soon as the first one finishes (a single one, however many calls
    came in between). */
export function loadAcpModels(force = false): Promise<void> {
  if (acpInflight) {
    acpQueuedForce ||= force;
    acpQueued ??= acpInflight.then(() => {
      const again = acpQueuedForce;
      acpQueued = null;
      acpQueuedForce = false;
      return loadAcpModels(again);
    });
    return acpQueued;
  }
  setAcpLoading(true);
  acpInflight = (async () => {
    try {
      const res = await fetch(`/api/acp/models${force ? "?force=1" : ""}`);
      const json = (await res.json()) as { models?: Model[]; modes?: Record<string, AgentModes>; commands?: Record<string, SlashCommand[]> };
      if (!res.ok || !json.models) return;
      /* The agents' own commands come with their models: the composer's list. */
      if (json.commands) setDiscoveredCommands(json.commands);
      const current = store.get();
      const openrouter = current.models.filter((m) => !isAcpProvider(m.providerId));
      const models = merge(openrouter, json.models);
      store.set({ ...current, models, providers: listProviders(models), acpModes: { ...current.acpModes, ...(json.modes ?? {}) } });
    } catch {
      /* without a connected subscription, nothing to add */
    } finally {
      acpInflight = null;
      setAcpLoading(acpQueued !== null);
    }
  })();
  return acpInflight;
}

function setAcpLoading(acpLoading: boolean) {
  const current = store.get();
  if (current.acpLoading !== acpLoading) store.set({ ...current, acpLoading });
}

let watching = false;
function watchAuth() {
  if (watching) return;
  watching = true;
  let known = "";
  onAcpAuthChange((agents) => {
    /* A new version of an agent (`build`, after an update) brings its
       new models: that is a change too. */
    const now = agents
      .filter((a) => a.loggedIn)
      .map((a) => `${a.agent}:${a.build ?? ""}`)
      .join(",");
    if (now !== known) {
      known = now;
      void loadAcpModels();
    }
  });
}

export function useCatalog(): Catalog {
  const catalog = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  /* Loading starts after mount, never during render: updating the store
     mid-render would wake other components at the wrong time. */
  useEffect(() => {
    watchAuth();
    if (store.get().status === "idle") void loadCatalog();
  }, []);
  return catalog;
}
