"use client";

import { useState } from "react";
import type { AgentConfig, AuthMode, ExchangeAccount } from "@/lib/domain/types";
import { acpAgentOf, isAcpProvider } from "@/lib/acp/agents";
import { useCatalog } from "@/lib/catalog/use-catalog";
import { PROFESSIONS, professionText } from "@/lib/professions/catalog";
import { useMessages } from "@/lib/i18n/react";
import { Field } from "@/components/ui/field";
import { ContextFiles } from "./context-files";
import { FolderField } from "./folder-field";
import { ProviderPicker, type ProviderSource } from "./provider-picker";
import type { StepErrors } from "./wizard";

type Props = {
  value: AgentConfig;
  errors: StepErrors;
  isNew: boolean;
  /** The tab chosen at authentication: the source offered first. */
  authMode: AuthMode;
  /** The account's exchange accounts: the agent picks the ones it drives. */
  exchanges: ExchangeAccount[];
  onChange: (agent: AgentConfig) => void;
};

export function StepAgent({ value, errors, isNew, authMode, exchanges, onChange }: Props) {
  const m = useMessages();
  const t = m.onboarding.agent;
  const picked = value.exchangeAccountIds ?? [];
  const toggleAccount = (id: string) => set({ exchangeAccountIds: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] });
  const set = (patch: Partial<AgentConfig>) => onChange({ ...value, ...patch });
  /* The source of the models: derived from the provider already chosen,
     otherwise the authentication's. Changing it clears the provider. */
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
    setPicking(true);
    set({ providerId: "", defaultModelId: null });
  };
  /* Once chosen, the provider folds into one line (2026-10-09: « trop
     d'info et trop long »); a click on it opens the list again. */
  const [picking, setPicking] = useState(!value.providerId);
  const catalog = useCatalog();
  const acp = acpAgentOf(value.providerId);
  const chosen = acp
    ? { title: acp.label, desc: t.viaSubscription(acp.product) }
    : { title: catalog.providers.find((p) => p.id === value.providerId)?.name ?? value.providerId, desc: t.viaKey };
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        {isNew ? t.newTitle : value.name}
      </h1>
      <p className="ob-lede">{t.lede}</p>

      <div className="ob-form">
        <Field id="agentName" label={t.name} error={errors.name}>
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
          <span className="field-label">{t.access}</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label={t.accessGroup}
          >
            <button
              type="button"
              role="radio"
              aria-checked={source === "subscription"}
              className={`ob-choice-btn${source === "subscription" ? " is-on" : ""}`}
              onClick={() => chooseSource("subscription")}
            >
              <span className="ob-choice-title">{t.bySubscription}</span>
              <span className="ob-choice-desc">{t.bySubscriptionDesc}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "keys"}
              className={`ob-choice-btn${source === "keys" ? " is-on" : ""}`}
              onClick={() => chooseSource("keys")}
            >
              <span className="ob-choice-title">{t.byKey}</span>
              <span className="ob-choice-desc">{t.byKeyDesc}</span>
            </button>
          </div>
        </div>

        <Field
          id="provider"
          label={source === "subscription" ? t.subscription : t.vendor}
          error={errors.providerId}
        >
          {value.providerId && !picking ? (
            <button type="button" id="provider" className="ob-choice-btn pv-row is-on pv-chosen" aria-expanded={false} onClick={() => setPicking(true)}>
              <span className="pv-row-text">
                <span className="ob-choice-title">{chosen.title}</span>
                <span className="ob-choice-desc">{chosen.desc}</span>
              </span>
              <span className="pv-change">{t.change}</span>
            </button>
          ) : (
            <ProviderPicker
              id="provider"
              value={value.providerId}
              source={source}
              onChange={(providerId) => {
                set({ providerId, defaultModelId: null });
                setPicking(false);
              }}
            />
          )}
        </Field>

        <div className="field">
          <span className="field-label">{t.profession}</span>
          <div
            className="ob-choice ob-choice-4"
            role="radiogroup"
            aria-label={t.professionGroup}
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
                <span className="ob-choice-title">{professionText(p.id, m).label}</span>
                <span className="ob-choice-desc">{professionText(p.id, m).description}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">{t.professionHint(<span className="mono">professions/</span>)}</p>
        </div>

        {/* Side by side: what the agent should know, written or as files. */}
        <div className="ob-row ob-row-top">
          <Field
            id="contextText"
            label={t.context}
            optional
            hint={t.contextHint}
          >
            <textarea
              id="contextText"
              className="field-input"
              placeholder={t.contextPlaceholder}
              value={value.contextText}
              onChange={(e) => set({ contextText: e.target.value })}
            />
          </Field>

          <div className="field">
            <span className="field-label">
              {t.files}
              <small>{m.common.optional}</small>
            </span>
            <ContextFiles
              value={value.contextFiles}
              onChange={(contextFiles) => set({ contextFiles })}
            />
          </div>
        </div>

        <Field
          id="workspace"
          label={t.workspace}
          optional
          hint={t.workspaceHint}
        >
          <FolderField
            id="workspace"
            value={value.workspace ?? ""}
            onChange={(workspace) => set({ workspace })}
          />
        </Field>

        <div className="field">
          <span className="field-label">{t.scope}</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label={t.scopeGroup}
          >
            <button
              type="button"
              role="radio"
              aria-checked={(value.scope ?? "workspace") === "workspace"}
              className={`ob-choice-btn${(value.scope ?? "workspace") === "workspace" ? " is-on" : ""}`}
              onClick={() => set({ scope: "workspace" })}
            >
              <span className="ob-choice-title">{t.scopeWorkspace}</span>
              <span className="ob-choice-desc">{t.scopeWorkspaceDesc}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.scope === "disk"}
              className={`ob-choice-btn${value.scope === "disk" ? " is-on" : ""}`}
              onClick={() => set({ scope: "disk" })}
            >
              <span className="ob-choice-title">{t.scopeDisk}</span>
              <span className="ob-choice-desc">{t.scopeDiskDesc}</span>
            </button>
          </div>
        </div>

        {/* For ALL agents, by key or by subscription: subscription agents
            receive the same tools through the MCP server. */}
        <div className="field">
          <span className="field-label">{t.exchanges}</span>
          {exchanges.length === 0 ? (
            <p className="field-hint">{t.noExchange}</p>
          ) : (
            <>
              <p className="field-hint">{t.exchangesHint}</p>
              <div className="xch-pick">
                {exchanges.map((a) => (
                  <label key={a.id}>
                    <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                    <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? t.testnet : t.live}</span>
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
