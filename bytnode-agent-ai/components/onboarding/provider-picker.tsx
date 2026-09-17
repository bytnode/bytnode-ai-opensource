"use client";

import { useState } from "react";
import { searchProviders } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import { ACP_AGENTS, acpAgentOf, isAcpProvider, type AcpAgentId } from "@/lib/acp/agents";
import { acpInstall, acpLogin, useAcpAuth } from "@/lib/acp/use-auth";
import { Check, ChevronDown, Spinner } from "@/components/ui/icons";
import { SearchPanel } from "@/components/ui/search-panel";

export type ProviderSource = "subscription" | "keys";

type Props = {
  id: string;
  value: string;
  /** Ce qu'on liste : les abonnements (Claude, OpenAI, Gemini… — grises
      tant qu'on n'y est pas connecte) ou les editeurs presents sur
      OpenRouter, avec la recherche. */
  source: ProviderSource;
  onChange: (providerId: string) => void;
};

/* Le choix du fournisseur : un bouton a la taille d'un champ, qui ouvre la
   liste de la source choisie, barre de recherche en tete. */
export function ProviderPicker({ id, value, source, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const catalog = useCatalog();
  const auth = useAcpAuth();

  const acp = acpAgentOf(value);
  const current = acp ? { id: acp.providerId, name: acp.label } : catalog.providers.find((p) => p.id === value);
  const q = query.trim().toLowerCase();
  const results = source === "keys" ? searchProviders(catalog.providers, query).filter((p) => !isAcpProvider(p.id)) : [];
  const subs = source === "subscription" ? ACP_AGENTS.filter((a) => !q || a.label.toLowerCase().includes(q) || a.product.toLowerCase().includes(q)) : [];
  const statusOf = (agent: AcpAgentId) => auth.agents.find((a) => a.agent === agent);
  const [busy, setBusy] = useState<AcpAgentId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /* Se connecter (ou installer) sans quitter la liste : la ligne devient
     un choix des que l'etat repasse a « connecté ». */
  const act = async (agent: AcpAgentId, install: boolean) => {
    setBusy(agent);
    setFailure(null);
    const msg = await (install ? acpInstall(agent) : acpLogin(agent));
    if (msg) setFailure(msg);
    setBusy(null);
  };

  const choose = (providerId: string) => {
    onChange(providerId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="picker">
      <button
        id={id}
        type="button"
        className={`picker-trigger as-field${current ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{current ? current.name : value || (source === "subscription" ? "Choisir un abonnement" : "Choisir un éditeur")}</span>
        <ChevronDown />
      </button>

      <SearchPanel
        open={open}
        onClose={() => setOpen(false)}
        query={query}
        onQuery={setQuery}
        placeholder={source === "subscription" ? "Rechercher un abonnement" : "Rechercher un éditeur"}
        label="Fournisseurs"
        align="end"
        width={440}
      >
        {source === "subscription" && subs.length === 0 && <SearchPanel.Empty>Aucun abonnement ne correspond à « {query} ».</SearchPanel.Empty>}
        {subs.length > 0 && (
          <>
            {subs.map((a) => {
              const st = statusOf(a.id);
              const loading = auth.status === "loading" || auth.status === "idle" || st?.checking === true;
              if (st?.loggedIn) {
                return (
                  <SearchPanel.Item
                    key={a.providerId}
                    title={a.label}
                    meta={`via ${a.product}`}
                    selected={a.providerId === value}
                    onSelect={() => choose(a.providerId)}
                    trailing={a.providerId === value ? <Check /> : undefined}
                  />
                );
              }
              const toInstall = !!st && !st.available && a.distribution === "download";
              const waiting = busy === a.id || !!st?.connecting || !!st?.installing;
              const meta = loading
                ? "Lecture…"
                : st?.installing
                  ? `Téléchargement de ${a.product}…`
                  : st?.connecting
                    ? "Connexion en cours — terminez dans la fenêtre ouverte."
                    : st && !st.available && !toInstall
                      ? (st.message ?? "Indisponible sur cette installation.")
                      : `${a.plan} · via ${a.product}`;
              return (
                <SearchPanel.Row
                  key={a.providerId}
                  title={a.label}
                  meta={meta}
                  action={
                    <button
                      type="button"
                      className={`btn btn-sm${toInstall ? "" : " btn-primary"}`}
                      disabled={loading || waiting || (!!st && !st.available && !toInstall)}
                      onClick={() => void act(a.id, toInstall)}
                    >
                      {waiting ? <Spinner /> : null}
                      {st?.installing ? "Installation" : st?.connecting ? "En attente" : toInstall ? "Installer" : "Se connecter"}
                    </button>
                  }
                />
              );
            })}
            {failure && <SearchPanel.Empty>{failure}</SearchPanel.Empty>}
          </>
        )}
        {source === "keys" && (catalog.status === "loading" || catalog.status === "idle" ? (
          <SearchPanel.Empty>Lecture du catalogue OpenRouter…</SearchPanel.Empty>
        ) : catalog.status === "error" ? (
          <SearchPanel.Empty>
            {catalog.message}
            <br />
            <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => loadCatalog(true)}>
              Recharger
            </button>
          </SearchPanel.Empty>
        ) : results.length === 0 ? (
          <SearchPanel.Empty>Aucun éditeur ne correspond à « {query} ».</SearchPanel.Empty>
        ) : (
          <>
            {results.map((p) => (
              <SearchPanel.Item
                key={p.id}
                title={p.name}
                meta={p.id}
                selected={p.id === value}
                onSelect={() => choose(p.id)}
                trailing={
                  p.id === value ? (
                    <Check />
                  ) : (
                    <span className="sp-item-count">
                      {p.modelCount} modèle{p.modelCount > 1 ? "s" : ""}
                    </span>
                  )
                }
              />
            ))}
          </>
        ))}
      </SearchPanel>
    </div>
  );
}
