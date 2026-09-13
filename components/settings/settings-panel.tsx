"use client";

import { useState, type ReactNode } from "react";
import type { AgentConfig, Profile, Settings, Theme } from "@/lib/domain/types";
import { ACP_AGENTS, acpAgentOf } from "@/lib/acp/agents";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { blankAgent } from "@/lib/storage/repositories";
import { professionInfo } from "@/lib/professions/catalog";
import { allowedAccounts, anyLive } from "@/lib/tools/exchange/accounts";
import { ArrowLeft, Close, Pencil, Plus, Trash } from "@/components/ui/icons";
import { StepAgent } from "@/components/onboarding/step-agent";
import { BytnodeKey, OpenRouterKey, Subscriptions } from "@/components/onboarding/step-auth";
import { ExchangeAccounts } from "@/components/onboarding/exchange-accounts";
import type { StepErrors } from "@/components/onboarding/wizard";
import "@/components/onboarding/onboarding.css";
import "./settings.css";

/* ---------------------------------------------------------------------------
   Les reglages : un panneau, une navigation a gauche, quatre sections.

   Tout s'enregistre au fil de la frappe — il n'y a ni brouillon ni bouton
   « Enregistrer », fermer ne perd rien. Seule exception : le formulaire d'un
   agent, qui a une validation (un nom, un fournisseur) et garde donc son
   bouton. L'assistant du premier demarrage (`Wizard`) n'est plus utilise
   qu'a la premiere ouverture.
--------------------------------------------------------------------------- */

export type SettingsTab = "general" | "auth" | "agents" | "providers";

/** Ce que le panneau montre a l'ouverture : un onglet, et pour Agents, un
    agent a modifier ou `"new"` pour en creer un. */
export type SettingsTarget = { tab: SettingsTab; agent?: AgentConfig | "new" };

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "Général" },
  { id: "auth", label: "Auth" },
  { id: "agents", label: "Agents" },
  { id: "providers", label: "Fournisseurs" },
];

type Props = {
  settings: Settings;
  target: SettingsTarget;
  onUpdate: (patch: Partial<Settings>) => void;
  onSaveAgent: (agent: AgentConfig, isNew: boolean) => void;
  onRemoveAgent: (agent: AgentConfig) => void;
  /** Absent quand on ne peut pas fermer : aucun agent n'existe encore. */
  onClose?: () => void;
};

type AgentView = { kind: "list" } | { kind: "form"; agent: AgentConfig; isNew: boolean };

export function SettingsPanel({ settings, target, onUpdate, onSaveAgent, onRemoveAgent, onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>(target.tab);
  const [view, setView] = useState<AgentView>(() =>
    target.agent === "new" ? { kind: "form", agent: blankAgent(), isNew: true } : target.agent ? { kind: "form", agent: target.agent, isNew: false } : { kind: "list" },
  );
  const mustCreate = settings.agents.length === 0;

  const go = (next: SettingsTab) => {
    setTab(next);
    if (next !== "agents") setView({ kind: "list" });
  };

  return (
    <div className="ob st-veil" role="dialog" aria-modal="true" aria-labelledby="st-title">
      <div className="st">
        <nav className="st-nav" aria-label="Sections des réglages">
          <span className="st-nav-title">Réglages</span>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`st-nav-item${tab === t.id ? " is-on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="st-main">
          {onClose && (
            <button type="button" className="st-close" onClick={onClose} aria-label="Fermer les réglages">
              <Close />
            </button>
          )}
          <div className="st-content" key={`${tab}:${view.kind}`}>
            {tab === "general" && <General settings={settings} onUpdate={onUpdate} />}
            {tab === "auth" && <Auth settings={settings} onUpdate={onUpdate} />}
            {tab === "agents" && view.kind === "list" && (
              <AgentsList
                settings={settings}
                onNew={() => setView({ kind: "form", agent: blankAgent(), isNew: true })}
                onEdit={(agent) => setView({ kind: "form", agent, isNew: false })}
                onRemove={onRemoveAgent}
              />
            )}
            {tab === "agents" && view.kind === "form" && (
              <AgentForm
                key={view.agent.id || "new"}
                settings={settings}
                initial={view.agent}
                isNew={view.isNew}
                onBack={mustCreate ? undefined : () => setView({ kind: "list" })}
                onSave={(agent) => {
                  onSaveAgent(agent, view.isNew);
                  setView({ kind: "list" });
                }}
              />
            )}
            {tab === "providers" && <Providers settings={settings} onGoAuth={() => go("auth")} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Briques de mise en page ---------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-section">
      <h2 className="st-section-title">{title}</h2>
      {children}
    </section>
  );
}

/** Une ligne de reglage : le libelle et son aide a gauche, le controle a
    droite. `stack` pose le controle en dessous, pour ce qui a besoin de toute
    la largeur (un texte long, une cle a verifier). */
function Row({ id, label, hint, stack, children }: { id?: string; label: string; hint?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={`st-row${stack ? " is-stack" : ""}`}>
      <div className="st-row-text">
        {id ? (
          <label className="st-row-label" htmlFor={id}>
            {label}
          </label>
        ) : (
          <span className="st-row-label">{label}</span>
        )}
        {hint && <p className="st-row-hint">{hint}</p>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

/* --- Général ---------------------------------------------------------------- */

function General({ settings, onUpdate }: { settings: Settings; onUpdate: (p: Partial<Settings>) => void }) {
  const profile = settings.profile;
  const set = (patch: Partial<Profile>) => onUpdate({ profile: { ...profile, ...patch } });
  const theme = (t: Theme) => onUpdate({ theme: t });
  return (
    <>
      <h1 id="st-title" className="st-title">
        Général
      </h1>
      <Section title="Profil">
        <Row id="st-firstName" label="Prénom" hint="L'agent s'adresse à vous par ce prénom.">
          <input id="st-firstName" className="field-input" autoComplete="given-name" value={profile.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Row>
        <Row id="st-lastName" label="Nom">
          <input id="st-lastName" className="field-input" autoComplete="family-name" value={profile.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Row>
        <Row id="st-email" label="Email">
          <input id="st-email" className="field-input" type="email" autoComplete="email" value={profile.email} onChange={(e) => set({ email: e.target.value })} />
        </Row>
        <Row id="st-bio" label="À propos de vous" hint="Votre activité, vos habitudes, ce que chaque agent doit savoir de vous. Transmis à tous vos agents." stack>
          <textarea id="st-bio" className="field-input" placeholder="Trader crypto indépendant, je travaille surtout sur BTC et ETH…" value={profile.bio} onChange={(e) => set({ bio: e.target.value })} />
        </Row>
      </Section>
      <Section title="Préférences">
        <Row label="Apparence">
          <div className="st-seg" role="radiogroup" aria-label="Apparence">
            <button type="button" role="radio" aria-checked={settings.theme === "light"} className={`st-seg-btn${settings.theme === "light" ? " is-on" : ""}`} onClick={() => theme("light")}>
              Clair
            </button>
            <button type="button" role="radio" aria-checked={settings.theme === "dark"} className={`st-seg-btn${settings.theme === "dark" ? " is-on" : ""}`} onClick={() => theme("dark")}>
              Sombre
            </button>
          </div>
        </Row>
      </Section>
    </>
  );
}

/* --- Auth ------------------------------------------------------------------- */

function Auth({ settings, onUpdate }: { settings: Settings; onUpdate: (p: Partial<Settings>) => void }) {
  const keys = settings.keys;
  return (
    <>
      <h1 id="st-title" className="st-title">
        Auth
      </h1>
      <p className="st-lede">Vos clés restent dans ce navigateur et partent avec chaque requête. Rien n&apos;est écrit sur le disque.</p>
      <Section title="Clés">
        <div className="st-form ob-form">
          <OpenRouterKey value={keys.openrouter} onChange={(openrouter) => onUpdate({ keys: { ...keys, openrouter } })} />
          <BytnodeKey value={keys.bytnode} onChange={(bytnode) => onUpdate({ keys: { ...keys, bytnode } })} />
        </div>
      </Section>
      <Section title="Exchanges">
        <div className="st-form ob-form">
          <ExchangeAccounts value={keys.exchanges} onChange={(exchanges) => onUpdate({ keys: { ...keys, exchanges } })} />
        </div>
      </Section>
    </>
  );
}

/* --- Agents ----------------------------------------------------------------- */

function providerLabel(providerId: string): string {
  const acp = acpAgentOf(providerId);
  if (acp) return acp.label;
  if (!providerId) return "Sans fournisseur";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function AgentsList({ settings, onNew, onEdit, onRemove }: { settings: Settings; onNew: () => void; onEdit: (a: AgentConfig) => void; onRemove: (a: AgentConfig) => void }) {
  return (
    <>
      <div className="st-head">
        <h1 id="st-title" className="st-title">
          Agents
        </h1>
        <button type="button" className="btn btn-sm btn-primary" onClick={onNew}>
          <Plus />
          Nouvel agent
        </button>
      </div>
      {settings.agents.length === 0 ? (
        <p className="st-empty">Aucun agent. Créez le premier : un nom, un fournisseur de modèles, et il est prêt.</p>
      ) : (
        <ul className="st-agents">
          {settings.agents.map((a) => {
            const accounts = allowedAccounts(settings.keys.exchanges, a.exchangeAccountIds);
            const model = a.defaultModelId ? a.defaultModelId.replace(/^[^/]+\//, "") : null;
            return (
              <li key={a.id} className="st-agent">
                <div className="st-agent-text">
                  <span className="st-agent-name">
                    {a.name || "Sans nom"}
                    {accounts.length > 0 && <span className={`xch-badge${anyLive(accounts) ? " is-live" : ""}`}>{anyLive(accounts) ? "RÉEL" : "TESTNET"}</span>}
                  </span>
                  <span className="st-agent-meta">
                    {professionInfo(a.profession).label} · {providerLabel(a.providerId)}
                    {model ? ` · ${model}` : ""}
                    {a.workspace ? ` · ${a.workspace}` : ""}
                  </span>
                </div>
                <span className="st-agent-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEdit(a)} aria-label={`Modifier ${a.name}`}>
                    <Pencil />
                    Modifier
                  </button>
                  <button type="button" className="st-icon" onClick={() => onRemove(a)} aria-label={`Supprimer ${a.name}`} title="Supprimer">
                    <Trash />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function AgentForm({ settings, initial, isNew, onBack, onSave }: { settings: Settings; initial: AgentConfig; isNew: boolean; onBack?: () => void; onSave: (a: AgentConfig) => void }) {
  const [agent, setAgent] = useState<AgentConfig>(initial);
  const [attempted, setAttempted] = useState(false);
  const errors: StepErrors = {};
  if (!agent.name.trim()) errors.name = "Donnez un nom à votre agent.";
  if (!agent.providerId) errors.providerId = "Choisissez un abonnement ou un éditeur.";
  const valid = Object.keys(errors).length === 0;
  const submit = () => {
    if (!valid) {
      setAttempted(true);
      return;
    }
    onSave(agent);
  };
  return (
    <>
      {onBack && (
        <button type="button" className="st-back" onClick={onBack}>
          <ArrowLeft />
          Agents
        </button>
      )}
      <div className="st-agent-form">
        <StepAgent value={agent} errors={attempted ? errors : {}} isNew={isNew} authMode={settings.authMode} exchanges={settings.keys.exchanges} onChange={setAgent} />
      </div>
      <div className="st-foot">
        {onBack ? (
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Annuler
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-primary" onClick={submit}>
          {isNew ? "Créer l'agent" : "Enregistrer"}
        </button>
      </div>
    </>
  );
}

/* --- Fournisseurs ----------------------------------------------------------- */

function Providers({ settings, onGoAuth }: { settings: Settings; onGoAuth: () => void }) {
  const auth = useAcpAuth();
  const hasKey = settings.keys.openrouter.trim().length > 0;
  const connected = ACP_AGENTS.filter((a) => auth.agents.find((s) => s.agent === a.id)?.loggedIn).length;
  return (
    <>
      <h1 id="st-title" className="st-title">
        Fournisseurs
      </h1>
      <p className="st-lede">
        {connected + (hasKey ? 1 : 0) === 0 ? "Aucun fournisseur connecté : vos agents ne peuvent pas répondre." : `${connected + (hasKey ? 1 : 0)} fournisseur${connected + (hasKey ? 1 : 0) > 1 ? "s" : ""} prêt${connected + (hasKey ? 1 : 0) > 1 ? "s" : ""}.`}
      </p>
      <Section title="Par clé">
        <div className={`sub${hasKey ? " is-on" : ""}`}>
          <div className="sub-main">
            <span className="sub-name">OpenRouter</span>
            <span className="sub-desc">{hasKey ? "Clé enregistrée · tous les éditeurs, facturé à l'usage" : "Aucune clé"}</span>
          </div>
          <button type="button" className={`btn btn-sm${hasKey ? " btn-ghost" : " btn-primary"}`} onClick={onGoAuth}>
            {hasKey ? "Modifier la clé" : "Ajouter une clé"}
          </button>
        </div>
      </Section>
      <Section title="Par abonnement">
        <Subscriptions />
      </Section>
    </>
  );
}
