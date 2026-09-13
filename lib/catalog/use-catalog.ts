"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Model, Provider } from "@/lib/domain/types";
import { createStore } from "@/lib/state/store";
import { isAcpProvider } from "@/lib/acp/agents";
import type { AgentModes } from "@/lib/acp/translate";
import { onAcpAuthChange } from "@/lib/acp/use-auth";
import { listProviders } from "./catalog";

/* Le catalogue est lu une fois pour toute la session, quel que soit le nombre
   de composants qui le consultent.

   Deux sources, fondues dans la meme liste : OpenRouter (des milliers de
   modeles, pas de cle requise pour la liste) et les agents par abonnement
   connectes (quelques modeles chacun, ids `acp:<agent>/…`). La seconde
   est relue quand un abonnement se connecte. */

type Base = {
  models: Model[];
  providers: Provider[];
  /** Les modes publies par chaque agent par abonnement. */
  acpModes: Record<string, AgentModes>;
  /** Une lecture des modeles d'abonnement est en vol ou reste a rejouer :
      un fournisseur `acp:` sans modele n'est pas encore « sans modele ». */
  acpLoading: boolean;
};

export type Catalog =
  | ({ status: "idle" | "loading" } & Base)
  | ({ status: "ready" } & Base)
  | ({ status: "error"; message: string } & Base);

const store = createStore<Catalog>({ status: "idle", models: [], providers: [], acpModes: {}, acpLoading: false });

/** Le catalogue tel qu'il est, hors rendu. */
export const getCatalog = (): Catalog => store.get();

let inflight: Promise<void> | null = null;
let acpInflight: Promise<void> | null = null;
/* La relecture a rejouer apres celle en vol, et si elle doit forcer. */
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
      if (!res.ok || !json.models) throw new Error(json.error?.message ?? "Catalogue indisponible.");
      const acp = store.get().models.filter((m) => isAcpProvider(m.providerId));
      const models = merge(json.models, acp);
      store.set({ ...store.get(), status: "ready", models, providers: listProviders(models) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Catalogue indisponible.";
      const acp = store.get().models.filter((m) => isAcpProvider(m.providerId));
      store.set({ ...store.get(), status: "error", models: acp, providers: listProviders(acp), message });
    } finally {
      inflight = null;
    }
  })();
  void loadAcpModels();
  return inflight;
}

/** Les modeles des abonnements connectes, fondus dans le catalogue.

    ⚠️ UN APPEL PENDANT QU'UNE LECTURE EST EN VOL N'EST PAS PERDU. La reponse
    en vol a ete calculee AVANT ce qui motive l'appel — typiquement un agent
    interroge par le protocole (Grok, Copilot, Mistral) qui vient de passer
    a « connecté » pendant que la premiere lecture, longue au demarrage,
    fait publier leurs modeles aux autres. Le rendre tel quel laisserait
    l'agent connecte sans aucun modele jusqu'au prochain rechargement. On
    rejoue donc une lecture des que la premiere se termine (une seule,
    quel que soit le nombre d'appels entre-temps). */
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
      const json = (await res.json()) as { models?: Model[]; modes?: Record<string, AgentModes> };
      if (!res.ok || !json.models) return;
      const current = store.get();
      const openrouter = current.models.filter((m) => !isAcpProvider(m.providerId));
      const models = merge(openrouter, json.models);
      store.set({ ...current, models, providers: listProviders(models), acpModes: { ...current.acpModes, ...(json.modes ?? {}) } });
    } catch {
      /* sans abonnement connecte, rien a ajouter */
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
    const now = agents
      .filter((a) => a.loggedIn)
      .map((a) => a.agent)
      .join(",");
    if (now !== known) {
      known = now;
      void loadAcpModels();
    }
  });
}

export function useCatalog(): Catalog {
  const catalog = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  /* Le chargement part apres le montage, jamais pendant le rendu : mettre le
     magasin a jour en plein rendu reveillerait d'autres composants au mauvais
     moment. */
  useEffect(() => {
    watchAuth();
    if (store.get().status === "idle") void loadCatalog();
  }, []);
  return catalog;
}
