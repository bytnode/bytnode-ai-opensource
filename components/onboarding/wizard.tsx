"use client";

import { useState } from "react";
import type { AgentConfig, ApiKeys, AuthMode, Profile, Theme } from "@/lib/domain/types";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { ArrowLeft, ArrowRight, Close } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { StepProfil } from "./step-profil";
import { StepAuth } from "./step-auth";
import { StepAgent } from "./step-agent";
import "./onboarding.css";

/* ---------------------------------------------------------------------------
   L'assistant de configuration : une feuille posee au centre du fond.

   Il sert trois fois, avec les memes etapes assemblees autrement :
     - a la premiere ouverture : profil, cle, puis un premier agent ;
     - depuis l'engrenage : profil et cle seulement (le compte) ;
     - depuis « Nouvel agent » ou le crayon d'un agent : l'agent seul.
   La feuille travaille sur un BROUILLON et ne rend la main qu'a la fin —
   quitter en cours de route ne laisse rien a moitie rempli.
--------------------------------------------------------------------------- */

export type StepId = "profil" | "auth" | "agent";

const LABELS: Record<StepId, string> = { profil: "Profil", auth: "Authentification", agent: "Agent" };

export type WizardDraft = {
  profile: Profile;
  authMode: AuthMode;
  keys: ApiKeys;
  theme: Theme;
  agent: AgentConfig;
};

type Props = {
  steps: StepId[];
  initial: WizardDraft;
  /** Le libelle du dernier bouton : « Ouvrir le chat », « Créer l'agent »… */
  finishLabel: string;
  onDone: (draft: WizardDraft) => void;
  /** Present quand l'assistant peut se fermer sans rien changer. */
  onCancel?: () => void;
  /** Le theme s'applique tout de suite, brouillon ou pas : on veut voir le
      resultat avant de terminer. */
  onTheme: (theme: Theme) => void;
};

export function Wizard({ steps, initial, finishLabel, onDone, onCancel, onTheme }: Props) {
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [index, setIndex] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const auth = useAcpAuth();

  const step = steps[index];
  const last = index === steps.length - 1;

  const errors = validate(step, draft, auth.agents.some((a) => a.loggedIn));
  const valid = Object.keys(errors).length === 0;

  const next = () => {
    if (!valid) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    if (last) onDone(draft);
    else setIndex(index + 1);
  };

  const back = () => {
    setAttempted(false);
    setIndex(index - 1);
  };

  const shown = attempted ? errors : {};

  return (
    <div className="ob" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="ob-sheet">
        <header className="ob-head">
          <span className="ob-brand">BytNode-AI</span>
          <div className="ob-head-actions">
            <ThemeToggle
              theme={draft.theme}
              onChange={(theme) => {
                setDraft({ ...draft, theme });
                onTheme(theme);
              }}
            />
            {onCancel && (
              <button type="button" className="ob-close" onClick={onCancel} aria-label="Fermer sans enregistrer">
                <Close />
              </button>
            )}
          </div>
        </header>

        {/* Une seule etape n'est pas une sequence : pas de barre. */}
        {steps.length > 1 && (
          <ol className="ob-steps" aria-label="Étapes">
            {steps.map((s, i) => (
              <li
                key={s}
                className={i === index ? "is-current" : i < index ? "is-done" : ""}
                aria-current={i === index ? "step" : undefined}
              >
                {LABELS[s]}
              </li>
            ))}
          </ol>
        )}

        <div className="ob-body" key={step}>
          {step === "profil" && (
            <StepProfil
              value={draft.profile}
              errors={shown}
              onChange={(profile) => setDraft({ ...draft, profile })}
            />
          )}
          {step === "auth" && (
            <StepAuth
              mode={draft.authMode}
              keys={draft.keys}
              errors={shown}
              onMode={(authMode) => setDraft({ ...draft, authMode })}
              onKeys={(keys) => setDraft({ ...draft, keys })}
            />
          )}
          {step === "agent" && (
            <StepAgent
              value={draft.agent}
              errors={shown}
              isNew={initial.agent.id === ""}
              authMode={draft.authMode}
              onChange={(agent) => setDraft({ ...draft, agent })}
            />
          )}
        </div>

        <footer className="ob-foot">
          {index > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={back}>
              <ArrowLeft />
              Retour
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-primary" onClick={next}>
            {last ? finishLabel : "Suivant"}
            {!last && <ArrowRight />}
          </button>
        </footer>
      </div>
    </div>
  );
}

export type StepErrors = Partial<Record<"firstName" | "openrouter" | "subscription" | "name" | "providerId", string>>;

function validate(step: StepId, d: WizardDraft, subscribed: boolean): StepErrors {
  const e: StepErrors = {};
  if (step === "profil" && !d.profile.firstName.trim()) e.firstName = "Un prénom, pour que l'agent sache à qui il parle.";
  /* Il faut au moins un acces aux modeles : l'onglet ouvert dit lequel on
     attend, mais l'autre suffit aussi. */
  if (step === "auth" && !d.keys.openrouter.trim() && !subscribed) {
    if (d.authMode === "keys") e.openrouter = "La clé est nécessaire pour dialoguer — ou connectez un abonnement.";
    else e.subscription = "Connectez un abonnement pour continuer — ou saisissez une clé OpenRouter dans l'onglet Clés.";
  }
  if (step === "agent") {
    if (!d.agent.name.trim()) e.name = "Donnez un nom à votre agent.";
    if (!d.agent.providerId) e.providerId = "Choisissez un abonnement ou un éditeur.";
  }
  return e;
}
