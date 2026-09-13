"use client";

import { useState } from "react";
import { EFFORT_OFF, effortLabel, effortOptions, latestModels, searchModels } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import type { Model } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";
import { Check, ChevronDown } from "@/components/ui/icons";
import { SearchPanel } from "@/components/ui/search-panel";

type Props = {
  providerId: string;
  modelId: string | null;
  effort: string | null;
  onModel: (modelId: string) => void;
  onEffort: (effort: string | null) => void;
  /** Le mode courant et ceux qu'on peut choisir : les modes de l'agent
      externe (abonnements) ou nos deux modes de permission. */
  mode: string | null;
  modeOptions: Array<{ value: string; name: string; description?: string | null }>;
  onMode: (mode: string) => void;
  /** Le metier de l'agent : change son prompt et ses competences. */
  profession: string;
  professionOptions: Array<{ value: string; name: string; description?: string | null }>;
  onProfession: (profession: string) => void;
  disabled?: boolean;
  /** Sans fond : le modele en encre, l'effort en retrait, le chevron — pour
      le bloc de saisie. */
  quiet?: boolean;
};

/* Le nom court d'un modele : OpenRouter prefixe le nom de l'editeur
   (« Anthropic: Claude Sonnet 4 ») ; dans un panneau deja filtre par editeur,
   c'est du bruit. */
export const shortName = (m: Model) => m.name.replace(/^[^:]+:\s*/, "");

const fmtContext = (n: number | null) =>
  n === null ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M ctx` : `${Math.round(n / 1000)}k ctx`;

type View = "menu" | "model" | "effort" | "mode" | "profession";

/* ---------------------------------------------------------------------------
   Les reglages de la conversation, dans le bloc de saisie.

   Ferme : le modele courant, et l'effort s'il est fixe. Ouvert : deux
   lignes — Modele, Effort — et rien d'autre ; chacune ouvre sa propre vue,
   avec retour. Le modele : les trois derniers sortis du fournisseur, et une
   recherche pour tous les autres. L'effort : les niveaux que CE modele
   accepte, tels qu'OpenRouter les publie ; un modele qui ne raisonne pas n'a
   pas d'effort, et la ligne le dit au lieu de disparaitre.
--------------------------------------------------------------------------- */
export function ModelPicker({
  providerId,
  modelId,
  effort,
  mode,
  modeOptions,
  profession,
  professionOptions,
  onModel,
  onEffort,
  onMode,
  onProfession,
  disabled,
  quiet,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [query, setQuery] = useState("");
  const catalog = useCatalog();

  const current = catalog.models.find((m) => m.id === modelId);
  const efforts = current ? effortOptions(current) : [];
  const canEffort = efforts.length > 0;

  const openAt = (v: View) => {
    setView(v);
    setQuery("");
  };
  const close = () => {
    setOpen(false);
    setView("menu");
    setQuery("");
  };
  const toggle = () => {
    if (open) close();
    else {
      setView("menu");
      setOpen(true);
    }
  };

  const currentMode = modeOptions.find((m) => m.value === mode) ?? null;
  const currentProfession = professionOptions.find((p) => p.value === profession) ?? null;
  const modelLabel = current ? shortName(current) : modelId ? modelId.split("/").pop() : "Modèle";
  const effortValue = effort && efforts.includes(effort) ? effort : null;

  const searching = query.trim().length > 0;
  /* Un abonnement n'a que quelques modeles : tous, sans « derniers sortis ». */
  const acp = acpAgentOf(providerId);
  const results = searching ? searchModels(catalog.models, providerId, query) : acp ? searchModels(catalog.models, providerId, "") : latestModels(catalog.models, providerId);

  return (
    <div className="picker">
      <button
        type="button"
        className={`picker-trigger${quiet ? " is-quiet" : ""}${current || modelId ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Réglages : ${modelLabel}${effortValue ? `, effort ${effortLabel(effortValue)}` : ""}`}
        disabled={disabled}
        onClick={toggle}
      >
        <span>{modelLabel}</span>
        {effortValue && <span className={quiet ? "picker-effort" : "picker-badge"}>{effortLabel(effortValue)}</span>}
        <ChevronDown />
      </button>

      {view === "menu" && (
        <SearchPanel open={open} onClose={close} label="Réglages de la conversation" side="top" align="end" width={260} dense>
          <SearchPanel.Item
            title="Modèle"
            meta={current ? current.id : "aucun modèle"}
            onSelect={() => openAt("model")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Effort"
            meta={
              !current
                ? "choisissez d'abord un modèle"
                : !canEffort
                  ? "ce modèle ne raisonne pas"
                  : effortValue
                    ? effortLabel(effortValue)
                    : `par défaut${current.defaultEffort ? ` (${effortLabel(current.defaultEffort)})` : ""}`
            }
            disabled={!canEffort}
            onSelect={() => openAt("effort")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Mode"
            meta={modeOptions.length === 0 ? "aucun mode" : (currentMode?.name ?? "par défaut")}
            disabled={modeOptions.length === 0}
            onSelect={() => openAt("mode")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Profession"
            meta={currentProfession?.name ?? profession}
            onSelect={() => openAt("profession")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
        </SearchPanel>
      )}

      {view === "model" && (
        <SearchPanel
          open={open}
          onClose={close}
          title="Modèle"
          onBack={() => openAt("menu")}
          query={query}
          onQuery={setQuery}
          placeholder="Rechercher un modèle"
          label="Modèles"
          side="top"
          align="end"
          width={300}
          dense
        >
          {catalog.status === "loading" || catalog.status === "idle" ? (
            <SearchPanel.Empty>Lecture du catalogue…</SearchPanel.Empty>
          ) : acp && catalog.acpLoading && results.length === 0 ? (
            /* L'agent publie ses modeles a l'ouverture d'une session : quelques
               secondes au premier appel, pendant lesquelles « aucun modele »
               serait un mensonge. */
            <SearchPanel.Empty>Lecture des modèles de votre abonnement {acp.label}…</SearchPanel.Empty>
          ) : catalog.status === "error" ? (
            <SearchPanel.Empty>
              {catalog.message}
              <br />
              <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => loadCatalog(true)}>
                Recharger
              </button>
            </SearchPanel.Empty>
          ) : results.length === 0 ? (
            <SearchPanel.Empty>
              {searching ? `Aucun modèle ne correspond à « ${query} ».` : "Ce fournisseur n'a aucun modèle."}
            </SearchPanel.Empty>
          ) : (
            <>
              {!searching && <SearchPanel.Group>{acp ? `Modèles de votre abonnement ${acp.label}` : "Derniers sortis"}</SearchPanel.Group>}
              {results.map((m) => (
                <SearchPanel.Item
                  key={m.id}
                  title={shortName(m)}
                  meta={m.id}
                  selected={m.id === modelId}
                  onSelect={() => {
                    onModel(m.id);
                    close();
                  }}
                  trailing={m.id === modelId ? <Check /> : <span className="sp-item-count">{fmtContext(m.contextLength)}</span>}

                />
              ))}
            </>
          )}
        </SearchPanel>
      )}

      {view === "effort" && current && (
        <SearchPanel open={open} onClose={close} title="Effort" onBack={() => openAt("menu")} label="Effort" side="top" align="end" width={240} dense>
          <SearchPanel.Item
            title={`Par défaut${current.defaultEffort ? ` · ${effortLabel(current.defaultEffort)}` : ""}`}
            selected={effortValue === null}
            onSelect={() => {
              onEffort(null);
              close();
            }}
            trailing={effortValue === null ? <Check /> : undefined}
          />
          {efforts.map((e) => (
            <SearchPanel.Item
              key={e}
              title={e === EFFORT_OFF ? "Aucun · sans raisonnement" : effortLabel(e)}
              selected={e === effortValue}
              onSelect={() => {
                onEffort(e);
                close();
              }}
              trailing={e === effortValue ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}
      {view === "mode" && (
        <SearchPanel open={open} onClose={close} title="Mode" onBack={() => openAt("menu")} label="Mode" side="top" align="end" width={300} dense>
          {modeOptions.map((m) => (
            <SearchPanel.Item
              key={m.value}
              title={m.name}
              meta={m.description ?? undefined}
              selected={m.value === mode}
              onSelect={() => {
                onMode(m.value);
                close();
              }}
              trailing={m.value === mode ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}

      {view === "profession" && (
        <SearchPanel
          open={open}
          onClose={close}
          title="Profession"
          onBack={() => openAt("menu")}
          label="Profession"
          side="top"
          align="end"
          width={320}
          dense
        >
          {professionOptions.map((p) => (
            <SearchPanel.Item
              key={p.value}
              title={p.name}
              meta={p.description ?? undefined}
              selected={p.value === profession}
              onSelect={() => {
                onProfession(p.value);
                close();
              }}
              trailing={p.value === profession ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}

    </div>
  );
}
