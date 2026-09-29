"use client";

import { useState } from "react";
import type { AgentConfig, ApiKeys, AuthMode, Profile, Theme } from "@/lib/domain/types";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { ArrowLeft, ArrowRight, Close } from "@/components/ui/icons";
import { StepProfil } from "./step-profil";
import { StepAuth } from "./step-auth";
import { StepAgent } from "./step-agent";
import "./onboarding.css";

/* ---------------------------------------------------------------------------
   The setup wizard: a sheet laid at the centre of the backdrop.

   It now only serves the first launch: profile, access to the models, then a
   first agent. After that, everything goes through the settings panel
   (`components/settings/settings-panel.tsx`), which reuses its bricks.
   The sheet works on a DRAFT and only hands over at the end — leaving
   midway leaves nothing half filled in.
--------------------------------------------------------------------------- */

export type StepId = "profil" | "auth" | "agent";

const LABELS: Record<StepId, string> = { profil: "Profile", auth: "Authentication", agent: "Agent" };

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
  /** The label of the last button: "Open the chat", "Create the agent"… */
  finishLabel: string;
  onDone: (draft: WizardDraft) => void;
  /** Present when the wizard can close without changing anything. */
  onCancel?: () => void;
};

export function Wizard({ steps, initial, finishLabel, onDone, onCancel }: Props) {
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
            {onCancel && (
              <button type="button" className="ob-close" onClick={onCancel} aria-label="Close without saving">
                <Close />
              </button>
            )}
          </div>
        </header>

        {/* A single step is not a sequence: no bar. */}
        {steps.length > 1 && (
          <ol className="ob-steps" aria-label="Steps">
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
              exchanges={draft.keys.exchanges}
              onChange={(agent) => setDraft({ ...draft, agent })}
            />
          )}
        </div>

        <footer className="ob-foot">
          {index > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={back}>
              <ArrowLeft />
              Back
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-primary" onClick={next}>
            {last ? finishLabel : "Next"}
            {!last && <ArrowRight />}
          </button>
        </footer>
      </div>
    </div>
  );
}

export type StepErrors = Partial<Record<"firstName" | "openrouter" | "subscription" | "bytnode" | "name" | "providerId", string>>;

function validate(step: StepId, d: WizardDraft, subscribed: boolean): StepErrors {
  const e: StepErrors = {};
  if (step === "profil" && !d.profile.firstName.trim()) e.firstName = "A first name, so the agent knows who it is talking to.";
  /* At least one access to the models is needed: the open tab says which
     one we expect, but the other one is enough too. */
  if (step === "auth" && !d.keys.openrouter.trim() && !subscribed) {
    if (d.authMode === "keys") e.openrouter = "The key is required to chat — or connect a subscription.";
    else e.subscription = "Connect a subscription to continue — or enter an OpenRouter key in the Keys tab.";
  }
  /* The BytNode key is not optional: without market data, the agent has
     nothing to analyse. */
  if (step === "auth" && !d.keys.bytnode.trim()) e.bytnode = "The BytNode key is required: without it, the agents have no market data.";
  if (step === "agent") {
    if (!d.agent.name.trim()) e.name = "Give your agent a name.";
    if (!d.agent.providerId) e.providerId = "Choose a subscription or a vendor.";
  }
  return e;
}
