"use client";

import { useState } from "react";
import type { AgentConfig, AuthMode, ExchangeAccount } from "@/lib/domain/types";
import { isAcpProvider } from "@/lib/acp/agents";
import { PROFESSIONS } from "@/lib/professions/catalog";
import { Field } from "@/components/ui/field";
import { ContextFiles } from "./context-files";
import { FolderField } from "./folder-field";
import { ProviderPicker, type ProviderSource } from "./provider-picker";
import type { StepErrors } from "./wizard";

type Props = {
  value: AgentConfig;
  errors: StepErrors;
  isNew: boolean;
  /** L'onglet choisi a l'authentification : la source proposee d'abord. */
  authMode: AuthMode;
  /** Les comptes exchange du compte : l'agent choisit ceux qu'il pilote. */
  exchanges: ExchangeAccount[];
  onChange: (agent: AgentConfig) => void;
};

export function StepAgent({ value, errors, isNew, authMode, exchanges, onChange }: Props) {
  const picked = value.exchangeAccountIds ?? [];
  const toggleAccount = (id: string) => set({ exchangeAccountIds: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] });
  const set = (patch: Partial<AgentConfig>) => onChange({ ...value, ...patch });
  /* La source des modeles : deduite du fournisseur deja choisi, sinon celle
     de l'authentification. En changer vide le fournisseur. */
  const [source, setSource] = useState<ProviderSource>(
    value.providerId
      ? isAcpProvider(value.providerId)
        ? "subscription"
        : "keys"
      : authMode,
  );
  const chooseSource = (next: ProviderSource) => {
    if (next === source) return;
    setSource(next);
    set({ providerId: "", defaultModelId: null });
  };
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        {isNew ? "Un nouvel agent" : value.name}
      </h1>
      <p className="ob-lede">
        Un nom, un fournisseur de modèles, et ce qu&apos;il doit savoir avant de
        vous répondre. Vous choisirez le modèle exact dans chaque conversation.
      </p>

      <div className="ob-form">
        <Field id="agentName" label="Nom" error={errors.name}>
          <input
            id="agentName"
            className="field-input"
            autoFocus
            placeholder="Nova"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Accès aux modèles</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label="Source des modèles"
          >
            <button
              type="button"
              role="radio"
              aria-checked={source === "subscription"}
              className={`ob-choice-btn${source === "subscription" ? " is-on" : ""}`}
              onClick={() => chooseSource("subscription")}
            >
              <span className="ob-choice-title">Par abonnement</span>
              <span className="ob-choice-desc">
                Claude, OpenAI, Gemini, GitHub Copilot, Grok, Mistral :
                l&apos;agent de l&apos;éditeur, sur votre compte, sans jeton
                supplémentaire.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "keys"}
              className={`ob-choice-btn${source === "keys" ? " is-on" : ""}`}
              onClick={() => chooseSource("keys")}
            >
              <span className="ob-choice-title">Par clé OpenRouter</span>
              <span className="ob-choice-desc">
                Tous les éditeurs du catalogue OpenRouter, avec les outils de
                BytNode-AI, facturé à l&apos;usage sur votre clé.
              </span>
            </button>
          </div>
        </div>

        <Field
          id="provider"
          label={source === "subscription" ? "Abonnement" : "Éditeur"}
          error={errors.providerId}
        >
          <ProviderPicker
            id="provider"
            value={value.providerId}
            source={source}
            onChange={(providerId) => set({ providerId, defaultModelId: null })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Profession</span>
          <div
            className="ob-choice ob-choice-4"
            role="radiogroup"
            aria-label="Profession de l'agent"
          >
            {PROFESSIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={value.profession === p.id}
                className={`ob-choice-btn${value.profession === p.id ? " is-on" : ""}`}
                onClick={() => set({ profession: p.id })}
              >
                <span className="ob-choice-title">{p.label}</span>
                <span className="ob-choice-desc">{p.description}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">
            La profession donne à l&apos;agent son prompt système et ses
            compétences (dossier <span className="mono">professions/</span>). Le
            contexte ci-dessous s&apos;y ajoute.
          </p>
        </div>

        <Field
          id="contextText"
          label="Contexte"
          optional
          hint="Ce que l'agent doit savoir : son rôle, votre activité, des consignes. Transmis au début de chaque conversation."
        >
          <textarea
            id="contextText"
            className="field-input"
            placeholder="Tu es l'assistant de …"
            value={value.contextText}
            onChange={(e) => set({ contextText: e.target.value })}
          />
        </Field>

        <div className="field">
          <span className="field-label">
            Fichiers de référence<small>facultatif</small>
          </span>
          <ContextFiles
            value={value.contextFiles}
            onChange={(contextFiles) => set({ contextFiles })}
          />
        </div>

        <Field
          id="workspace"
          label="Dossier de travail"
          optional
          hint="Là où l'agent démarre ses commandes et résout les chemins relatifs. Vide : un dossier workspaces/<id> dans le projet."
        >
          <FolderField
            id="workspace"
            value={value.workspace ?? ""}
            onChange={(workspace) => set({ workspace })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Périmètre</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label="Périmètre des outils fichiers"
          >
            <button
              type="button"
              role="radio"
              aria-checked={(value.scope ?? "workspace") === "workspace"}
              className={`ob-choice-btn${(value.scope ?? "workspace") === "workspace" ? " is-on" : ""}`}
              onClick={() => set({ scope: "workspace" })}
            >
              <span className="ob-choice-title">
                Dossier de travail seulement
              </span>
              <span className="ob-choice-desc">
                Les outils fichiers refusent tout chemin extérieur, et une
                commande shell qui en désigne un est refusée avant de partir
                (garde sur le texte de la commande — combinez avec « Demande
                avant d&apos;agir » pour un vrai filet).
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.scope === "disk"}
              className={`ob-choice-btn${value.scope === "disk" ? " is-on" : ""}`}
              onClick={() => set({ scope: "disk" })}
            >
              <span className="ob-choice-title">Tout le disque</span>
              <span className="ob-choice-desc">
                N&apos;importe quel chemin absolu est accepté. Le dossier de
                travail n&apos;est que le point de départ.
              </span>
            </button>
          </div>
        </div>

        {source === "keys" && (
          <>
            <div className="field">
              <span className="field-label">Outils</span>
              <div
                className="ob-choice"
                role="radiogroup"
                aria-label="Mode d'exécution des outils"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={(value.permissionMode ?? "ask") === "ask"}
                  className={`ob-choice-btn${(value.permissionMode ?? "ask") === "ask" ? " is-on" : ""}`}
                  onClick={() => set({ permissionMode: "ask" })}
                >
                  <span className="ob-choice-title">
                    Demande avant d&apos;agir
                  </span>
                  <span className="ob-choice-desc">
                    Chaque commande shell et chaque modification de fichier
                    attend votre accord.
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.permissionMode === "skip"}
                  className={`ob-choice-btn${value.permissionMode === "skip" ? " is-on" : ""}`}
                  onClick={() => set({ permissionMode: "skip" })}
                >
                  <span className="ob-choice-title">Exécution directe</span>
                  <span className="ob-choice-desc">
                    Tous les outils s&apos;exécutent sans demander. Plus rapide,
                    sans filet. Les ordres, fermetures et transferts sur un
                    exchange demandent quand même.
                  </span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Pour TOUS les agents, par cle ou par abonnement : les agents
            par abonnement recoivent les memes outils par le serveur MCP. */}
        <div className="field">
          <span className="field-label">Comptes exchange</span>
          {exchanges.length === 0 ? (
            <p className="field-hint">Ajoutez un compte dans Réglages → Auth pour que cet agent puisse trader.</p>
          ) : (
            <>
              <p className="field-hint">Les comptes que cet agent peut lire et piloter. Aucun : pas d&apos;outil exchange.</p>
              <div className="xch-pick">
                {exchanges.map((a) => (
                  <label key={a.id}>
                    <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                    <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "RÉEL"}</span>
                    <span>{a.label}</span>
                    <span className="xch-exchange">{a.exchange}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
