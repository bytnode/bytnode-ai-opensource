"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { PluginsLibrary } from "./plugins-library";
import "./settings.css";

/* ---------------------------------------------------------------------------
   The settings: one panel, a navigation on the left, five sections.

   Everything saves as you type — there is neither a draft nor a "Save"
   button, closing loses nothing. The only exception: an agent's form, which
   has validation (a name, a provider) and therefore keeps its button. The
   first-launch wizard (`Wizard`) is now only used on the first opening.
--------------------------------------------------------------------------- */

export type SettingsTab = "general" | "auth" | "agents" | "providers" | "plugins";

/** What the panel shows on opening: a tab, and for Agents, an agent to
    edit or `"new"` to create one; for Plugins, a plugin's page. */
export type SettingsTarget = { tab: SettingsTab; agent?: AgentConfig | "new"; plugin?: string };

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "auth", label: "Auth" },
  { id: "agents", label: "Agents" },
  { id: "providers", label: "Providers" },
  { id: "plugins", label: "Plugins" },
];

type Props = {
  settings: Settings;
  target: SettingsTarget;
  onUpdate: (patch: Partial<Settings>) => void;
  onSaveAgent: (agent: AgentConfig, isNew: boolean) => void;
  onRemoveAgent: (agent: AgentConfig) => void;
  /** Absent when closing is not possible: no agent exists yet. */
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

  /* Escape closes, like the cross. */
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ob st-veil" role="dialog" aria-modal="true" aria-labelledby="st-title" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="st">
        {/* The cross sits on the panel, not in the scrolling area: it stays
            in place and on top whatever is scrolled. */}
        {onClose && (
          <button type="button" className="st-close" onClick={onClose} aria-label="Close the settings">
            <Close />
          </button>
        )}
        <nav className="st-nav" aria-label="Settings sections">
          <span className="st-nav-title">Settings</span>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`st-nav-item${tab === t.id ? " is-on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="st-main">
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
                  /* A creation closes the panel (see chat-shell); an edit
                     goes back to the list. */
                  if (!view.isNew) setView({ kind: "list" });
                }}
              />
            )}
            {tab === "providers" && <Providers settings={settings} onGoAuth={() => go("auth")} />}
            {tab === "plugins" && <PluginsLibrary settings={settings} initial={target.tab === "plugins" ? target.plugin : undefined} onUpdate={onUpdate} onGo={go} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Layout bricks --------------------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-section">
      <h2 className="st-section-title">{title}</h2>
      {children}
    </section>
  );
}

/** A settings row: the label and its hint on the left, the control on the
    right. `stack` puts the control underneath, for what needs the full
    width (a long text, a key to verify). */
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

/* --- General ---------------------------------------------------------------- */

function General({ settings, onUpdate }: { settings: Settings; onUpdate: (p: Partial<Settings>) => void }) {
  const profile = settings.profile;
  const set = (patch: Partial<Profile>) => onUpdate({ profile: { ...profile, ...patch } });
  const theme = (t: Theme) => onUpdate({ theme: t });
  return (
    <>
      <h1 id="st-title" className="st-title">
        General
      </h1>
      <Section title="Profile">
        <Row id="st-firstName" label="First name" hint="The agent addresses you by this first name.">
          <input id="st-firstName" className="field-input" autoComplete="given-name" value={profile.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Row>
        <Row id="st-lastName" label="Last name">
          <input id="st-lastName" className="field-input" autoComplete="family-name" value={profile.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Row>
        <Row id="st-email" label="Email">
          <input id="st-email" className="field-input" type="email" autoComplete="email" value={profile.email} onChange={(e) => set({ email: e.target.value })} />
        </Row>
        <Row id="st-bio" label="About you" hint="Your activity, your habits, what every agent should know about you. Passed on to all your agents." stack>
          <textarea id="st-bio" className="field-input" placeholder="Independent crypto trader, I mostly work on BTC and ETH…" value={profile.bio} onChange={(e) => set({ bio: e.target.value })} />
        </Row>
      </Section>
      <Section title="Preferences">
        <Row label="Appearance">
          <div className="st-seg" role="radiogroup" aria-label="Appearance">
            <button type="button" role="radio" aria-checked={settings.theme === "light"} className={`st-seg-btn${settings.theme === "light" ? " is-on" : ""}`} onClick={() => theme("light")}>
              Light
            </button>
            <button type="button" role="radio" aria-checked={settings.theme === "dark"} className={`st-seg-btn${settings.theme === "dark" ? " is-on" : ""}`} onClick={() => theme("dark")}>
              Dark
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
      <p className="st-lede">Your keys stay in this browser and travel with every request. Nothing is written to disk.</p>
      <Section title="Keys">
        <div className="st-form ob-form">
          <OpenRouterKey value={keys.openrouter} onChange={(openrouter) => onUpdate({ keys: { ...keys, openrouter } })} />
          <BytnodeKey value={keys.bytnode} error={keys.bytnode.trim() ? undefined : "Required: without a BytNode key, the agents have no market data."} onChange={(bytnode) => onUpdate({ keys: { ...keys, bytnode } })} />
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
  if (!providerId) return "No provider";
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
          New agent
        </button>
      </div>
      {settings.agents.length === 0 ? (
        <p className="st-empty">No agent. Create the first one: a name, a model provider, and it is ready.</p>
      ) : (
        <ul className="st-agents">
          {settings.agents.map((a) => {
            const accounts = allowedAccounts(settings.keys.exchanges, a.exchangeAccountIds);
            const model = a.defaultModelId ? a.defaultModelId.replace(/^[^/]+\//, "") : null;
            return (
              <li key={a.id} className="st-agent">
                <div className="st-agent-text">
                  <span className="st-agent-name">
                    {a.name || "Unnamed"}
                    {accounts.length > 0 && <span className={`xch-badge${anyLive(accounts) ? " is-live" : ""}`}>{anyLive(accounts) ? "LIVE" : "TESTNET"}</span>}
                  </span>
                  <span className="st-agent-meta">
                    {professionInfo(a.profession).label} · {providerLabel(a.providerId)}
                    {model ? ` · ${model}` : ""}
                    {a.workspace ? ` · ${a.workspace}` : ""}
                  </span>
                </div>
                <span className="st-agent-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEdit(a)} aria-label={`Edit ${a.name}`}>
                    <Pencil />
                    Edit
                  </button>
                  <button type="button" className="st-icon" onClick={() => onRemove(a)} aria-label={`Delete ${a.name}`} title="Delete">
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
  if (!agent.name.trim()) errors.name = "Give your agent a name.";
  if (!agent.providerId) errors.providerId = "Choose a subscription or a vendor.";
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
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-primary" onClick={submit}>
          {isNew ? "Create the agent" : "Save"}
        </button>
      </div>
    </>
  );
}

/* --- Providers -------------------------------------------------------------- */

function Providers({ settings, onGoAuth }: { settings: Settings; onGoAuth: () => void }) {
  const auth = useAcpAuth();
  const hasKey = settings.keys.openrouter.trim().length > 0;
  const connected = ACP_AGENTS.filter((a) => auth.agents.find((s) => s.agent === a.id)?.loggedIn).length;
  return (
    <>
      <h1 id="st-title" className="st-title">
        Providers
      </h1>
      <p className="st-lede">
        {connected + (hasKey ? 1 : 0) === 0 ? "No provider connected: your agents cannot answer." : `${connected + (hasKey ? 1 : 0)} provider${connected + (hasKey ? 1 : 0) > 1 ? "s" : ""} ready.`}
      </p>
      <Section title="By key">
        <div className={`sub${hasKey ? " is-on" : ""}`}>
          <div className="sub-main">
            <span className="sub-name">OpenRouter</span>
            <span className="sub-desc">{hasKey ? "Key saved · every vendor, billed per use" : "No key"}</span>
          </div>
          <button type="button" className={`btn btn-sm${hasKey ? " btn-ghost" : " btn-primary"}`} onClick={onGoAuth}>
            {hasKey ? "Edit the key" : "Add a key"}
          </button>
        </div>
      </Section>
      <Section title="By subscription">
        <Subscriptions />
      </Section>
    </>
  );
}
