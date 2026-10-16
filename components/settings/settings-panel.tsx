"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AgentConfig, Profile, Settings, Theme } from "@/lib/domain/types";
import { ACP_AGENTS, acpAgentOf } from "@/lib/acp/agents";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { accountBridge, refreshAccount, useAccount } from "@/lib/account/account";
import { blankAgent } from "@/lib/storage/repositories";
import { updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import { professionText } from "@/lib/professions/catalog";
import { useMessages } from "@/lib/i18n/react";
import { allowedAccounts, anyLive } from "@/lib/tools/exchange/accounts";
import { ArrowLeft, Close, Pencil, Plus, Trash } from "@/components/ui/icons";
import { StepAgent } from "@/components/onboarding/step-agent";
import { BytnodeKey, OpenRouterKey, Subscriptions } from "@/components/onboarding/step-auth";
import { ExchangeAccounts } from "@/components/onboarding/exchange-accounts";
import { TelegramBots } from "@/components/onboarding/telegram-bots";
import type { StepErrors } from "@/components/onboarding/wizard";
import "@/components/onboarding/onboarding.css";
import { PluginsLibrary } from "./plugins-library";
import { WidgetsSettings } from "./widgets-settings";
import { LanguageSelect } from "@/components/ui/language-select";
import "./settings.css";

/* ---------------------------------------------------------------------------
   The settings: one PAGE, a navigation on the left, six sections — the
   whole window under the tab bar, not a panel over the app (user request,
   2026-10-09: « une page complète de config dans l'app »).

   Everything saves as you type — there is neither a draft nor a "Save"
   button, closing loses nothing. The only exception: an agent's form, which
   has validation (a name, a provider) and therefore keeps its button. The
   first-launch wizard (`Wizard`) is now only used on the first opening.
--------------------------------------------------------------------------- */

export type SettingsTab = "general" | "auth" | "agents" | "providers" | "plugins" | "widgets";

/** What the panel shows on opening: a tab, and for Agents, an agent to
    edit or `"new"` to create one; for Plugins, a plugin's page. */
export type SettingsTarget = { tab: SettingsTab; agent?: AgentConfig | "new"; plugin?: string };

/* In the navigation's order; their names are `m.settings.tabs`. */
const TABS: SettingsTab[] = ["general", "auth", "agents", "providers", "plugins", "widgets"];

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
  const m = useMessages();
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
    <div className="st-page" role="dialog" aria-modal="true" aria-labelledby="st-title">
      <div className="st">
        {/* The cross sits on the panel, not in the scrolling area: it stays
            in place and on top whatever is scrolled. */}
        {onClose && (
          <button type="button" className="st-close" onClick={onClose} aria-label={m.settings.close}>
            <Close />
          </button>
        )}
        <nav className="st-nav" aria-label={m.settings.sectionsNav}>
          <span className="st-nav-title">{m.settings.title}</span>
          {TABS.map((id) => (
            <button key={id} type="button" className={`st-nav-item${tab === id ? " is-on" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
              {m.settings.tabs[id]}
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
            {tab === "widgets" && <WidgetsSettings settings={settings} onGo={go} />}
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
  const floating = useUiPrefs().floatingAgent;
  const m = useMessages();
  const t = m.settings.general;
  return (
    <>
      <h1 id="st-title" className="st-title">
        {m.settings.tabs.general}
      </h1>
      <AccountSection />
      <Section title={t.profile}>
        <Row id="st-firstName" label={t.firstName} hint={t.firstNameHint}>
          <input id="st-firstName" className="field-input" autoComplete="given-name" value={profile.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Row>
        <Row id="st-lastName" label={t.lastName}>
          <input id="st-lastName" className="field-input" autoComplete="family-name" value={profile.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Row>
        <Row id="st-email" label={t.email}>
          <input id="st-email" className="field-input" type="email" autoComplete="email" value={profile.email} onChange={(e) => set({ email: e.target.value })} />
        </Row>
        <Row id="st-bio" label={t.bio} hint={t.bioHint} stack>
          <textarea id="st-bio" className="field-input" placeholder={t.bioPlaceholder} value={profile.bio} onChange={(e) => set({ bio: e.target.value })} />
        </Row>
      </Section>
      <Section title={t.preferences}>
        <Row id="st-language" label={m.language.label} hint={m.language.hint}>
          <LanguageSelect id="st-language" value={settings.language} />
        </Row>
        <Row label={t.appearance}>
          <div className="st-seg" role="radiogroup" aria-label={t.appearance}>
            <button type="button" role="radio" aria-checked={settings.theme === "light"} className={`st-seg-btn${settings.theme === "light" ? " is-on" : ""}`} onClick={() => theme("light")}>
              {t.light}
            </button>
            <button type="button" role="radio" aria-checked={settings.theme === "dark"} className={`st-seg-btn${settings.theme === "dark" ? " is-on" : ""}`} onClick={() => theme("dark")}>
              {t.dark}
            </button>
          </div>
        </Row>
        <Row label={t.floatingAgent} hint={t.floatingAgentHint}>
          <div className="st-seg" role="radiogroup" aria-label={t.floatingAgent}>
            <button type="button" role="radio" aria-checked={floating} className={`st-seg-btn${floating ? " is-on" : ""}`} onClick={() => updateUiPrefs({ floatingAgent: true })}>
              {m.common.shown}
            </button>
            <button type="button" role="radio" aria-checked={!floating} className={`st-seg-btn${!floating ? " is-on" : ""}`} onClick={() => updateUiPrefs({ floatingAgent: false })}>
              {m.common.hidden}
            </button>
          </div>
        </Row>
      </Section>
    </>
  );
}

/* The BytNode account: who is signed in, and signing out — which brings
   the sign-in page back and keeps everything on this computer (agents,
   conversations, keys). */
function AccountSection() {
  const account = useAccount();
  const t = useMessages().settings.account;
  const [busy, setBusy] = useState(false);
  if (!account?.signedIn) return null;
  const signOut = async () => {
    setBusy(true);
    await accountBridge()?.signOut();
    refreshAccount();
  };
  return (
    <Section title={t.title}>
      <Row label={account.account.name ?? account.account.email} hint={account.account.name ? account.account.email : t.signedIn}>
        <button type="button" className="btn btn-sm" onClick={signOut} disabled={busy}>
          {t.signOut}
        </button>
      </Row>
    </Section>
  );
}

/* --- Auth ------------------------------------------------------------------- */

function Auth({ settings, onUpdate }: { settings: Settings; onUpdate: (p: Partial<Settings>) => void }) {
  const keys = settings.keys;
  const m = useMessages();
  return (
    <>
      <h1 id="st-title" className="st-title">
        {m.settings.tabs.auth}
      </h1>
      <p className="st-lede">{m.settings.auth.lede}</p>
      {/* One block per service (user request): BytNode and OpenRouter
          apart, then the exchanges, then the channels things are sent to. */}
      {/* The app makes its own BytNode key at sign-in: no field
          (2026-10-09; in a browser too since 2026-10-12), unless it has none. */}
      {(!accountBridge() || !keys.bytnode.trim()) && (
        <Section title="BytNode">
          <div className="st-form ob-form">
            <BytnodeKey value={keys.bytnode} error={keys.bytnode.trim() ? undefined : m.settings.auth.bytnodeRequired} onChange={(bytnode) => onUpdate({ keys: { ...keys, bytnode } })} />
          </div>
        </Section>
      )}
      <Section title="OpenRouter">
        <div className="st-form ob-form">
          <OpenRouterKey value={keys.openrouter} onChange={(openrouter) => onUpdate({ keys: { ...keys, openrouter } })} />
        </div>
      </Section>
      <Section title={m.settings.auth.exchanges}>
        <div className="st-form ob-form">
          <ExchangeAccounts value={keys.exchanges} onChange={(exchanges) => onUpdate({ keys: { ...keys, exchanges } })} />
        </div>
      </Section>
      <Section title="Telegram">
        <div className="st-form ob-form">
          <TelegramBots value={keys.telegram} onChange={(telegram) => onUpdate({ keys: { ...keys, telegram } })} />
        </div>
      </Section>
    </>
  );
}

/* --- Agents ----------------------------------------------------------------- */

function providerLabel(providerId: string, none: string): string {
  const acp = acpAgentOf(providerId);
  if (acp) return acp.label;
  if (!providerId) return none;
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function AgentsList({ settings, onNew, onEdit, onRemove }: { settings: Settings; onNew: () => void; onEdit: (a: AgentConfig) => void; onRemove: (a: AgentConfig) => void }) {
  const m = useMessages();
  const t = m.settings.agents;
  return (
    <>
      <div className="st-head">
        <h1 id="st-title" className="st-title">
          {m.settings.tabs.agents}
        </h1>
        <button type="button" className="btn btn-sm btn-primary" onClick={onNew}>
          <Plus />
          {t.newAgent}
        </button>
      </div>
      {settings.agents.length === 0 ? (
        <p className="st-empty">{t.empty}</p>
      ) : (
        <ul className="st-agents">
          {settings.agents.map((a) => {
            const accounts = allowedAccounts(settings.keys.exchanges, a.exchangeAccountIds);
            const model = a.defaultModelId ? a.defaultModelId.replace(/^[^/]+\//, "") : null;
            return (
              <li key={a.id} className="st-agent">
                <div className="st-agent-text">
                  <span className="st-agent-name">
                    {a.name || t.unnamed}
                    {accounts.length > 0 && <span className={`xch-badge${anyLive(accounts) ? " is-live" : ""}`}>{anyLive(accounts) ? m.onboarding.agent.live : m.onboarding.agent.testnet}</span>}
                  </span>
                  <span className="st-agent-meta">
                    {professionText(a.profession, m).label} · {providerLabel(a.providerId, t.noProvider)}
                    {model ? ` · ${model}` : ""}
                    {a.workspace ? ` · ${a.workspace}` : ""}
                  </span>
                </div>
                <span className="st-agent-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEdit(a)} aria-label={t.editAgent(a.name)}>
                    <Pencil />
                    {m.common.edit}
                  </button>
                  <button type="button" className="st-icon" onClick={() => onRemove(a)} aria-label={t.deleteAgent(a.name)} title={m.common.delete}>
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
  const m = useMessages();
  const t = m.settings.agents;
  const [agent, setAgent] = useState<AgentConfig>(initial);
  const [attempted, setAttempted] = useState(false);
  const errors: StepErrors = {};
  if (!agent.name.trim()) errors.name = t.nameRequired;
  if (!agent.providerId) errors.providerId = t.providerRequired;
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
          {m.settings.tabs.agents}
        </button>
      )}
      <div className="st-agent-form">
        <StepAgent value={agent} errors={attempted ? errors : {}} isNew={isNew} authMode={settings.authMode} exchanges={settings.keys.exchanges} onChange={setAgent} />
      </div>
      <div className="st-foot">
        {onBack ? (
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            {m.common.cancel}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-primary" onClick={submit}>
          {isNew ? t.create : m.common.save}
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
  const ready = connected + (hasKey ? 1 : 0);
  const m = useMessages();
  const t = m.settings.providers;
  return (
    <>
      <h1 id="st-title" className="st-title">
        {m.settings.tabs.providers}
      </h1>
      <p className="st-lede">
        {ready === 0 ? t.none : t.ready(ready)}
      </p>
      <Section title={t.byKey}>
        <div className={`sub${hasKey ? " is-on" : ""}`}>
          <div className="sub-main">
            <span className="sub-name">OpenRouter</span>
            <span className="sub-desc">{hasKey ? t.keySaved : t.noKey}</span>
          </div>
          <button type="button" className={`btn btn-sm${hasKey ? " btn-ghost" : " btn-primary"}`} onClick={onGoAuth}>
            {hasKey ? t.editKey : t.addKey}
          </button>
        </div>
      </Section>
      <Section title={t.bySubscription}>
        <Subscriptions />
      </Section>
    </>
  );
}
