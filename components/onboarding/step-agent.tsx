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
  /** The tab chosen at authentication: the source offered first. */
  authMode: AuthMode;
  /** The account's exchange accounts: the agent picks the ones it drives. */
  exchanges: ExchangeAccount[];
  onChange: (agent: AgentConfig) => void;
};

export function StepAgent({ value, errors, isNew, authMode, exchanges, onChange }: Props) {
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
    set({ providerId: "", defaultModelId: null });
  };
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        {isNew ? "A new agent" : value.name}
      </h1>
      <p className="ob-lede">
        A name, a model provider, and what it should know before answering
        you. You will choose the exact model in each conversation.
      </p>

      <div className="ob-form">
        <Field id="agentName" label="Name" error={errors.name}>
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
          <span className="field-label">Access to the models</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label="Source of the models"
          >
            <button
              type="button"
              role="radio"
              aria-checked={source === "subscription"}
              className={`ob-choice-btn${source === "subscription" ? " is-on" : ""}`}
              onClick={() => chooseSource("subscription")}
            >
              <span className="ob-choice-title">By subscription</span>
              <span className="ob-choice-desc">
                Claude, OpenAI, Gemini, GitHub Copilot, Grok:
                the vendor&apos;s agent, on your account, with no extra
                token.
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "keys"}
              className={`ob-choice-btn${source === "keys" ? " is-on" : ""}`}
              onClick={() => chooseSource("keys")}
            >
              <span className="ob-choice-title">By OpenRouter key</span>
              <span className="ob-choice-desc">
                Every vendor in the OpenRouter catalog, with the BytNode-AI
                tools, billed per use on your key.
              </span>
            </button>
          </div>
        </div>

        <Field
          id="provider"
          label={source === "subscription" ? "Subscription" : "Vendor"}
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
            aria-label="Agent's profession"
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
            The profession gives the agent its system prompt and its
            skills (<span className="mono">professions/</span> folder). The
            context below is added to it.
          </p>
        </div>

        <Field
          id="contextText"
          label="Context"
          optional
          hint="What the agent should know: its role, your activity, instructions. Passed on at the start of every conversation."
        >
          <textarea
            id="contextText"
            className="field-input"
            placeholder="You are the assistant of …"
            value={value.contextText}
            onChange={(e) => set({ contextText: e.target.value })}
          />
        </Field>

        <div className="field">
          <span className="field-label">
            Reference files<small>optional</small>
          </span>
          <ContextFiles
            value={value.contextFiles}
            onChange={(contextFiles) => set({ contextFiles })}
          />
        </div>

        <Field
          id="workspace"
          label="Workspace"
          optional
          hint="Where the agent starts its commands and resolves relative paths. Empty: a ~/.bytnode-ai/workspaces/<id> folder."
        >
          <FolderField
            id="workspace"
            value={value.workspace ?? ""}
            onChange={(workspace) => set({ workspace })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Scope</span>
          <div
            className="ob-choice"
            role="radiogroup"
            aria-label="Scope of the file tools"
          >
            <button
              type="button"
              role="radio"
              aria-checked={(value.scope ?? "workspace") === "workspace"}
              className={`ob-choice-btn${(value.scope ?? "workspace") === "workspace" ? " is-on" : ""}`}
              onClick={() => set({ scope: "workspace" })}
            >
              <span className="ob-choice-title">
                Workspace only
              </span>
              <span className="ob-choice-desc">
                The file tools refuse any outside path, and a shell command
                that names one is refused before it runs (a guard on the
                command&apos;s text — combine with &quot;Ask before
                acting&quot; for a real safety net).
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.scope === "disk"}
              className={`ob-choice-btn${value.scope === "disk" ? " is-on" : ""}`}
              onClick={() => set({ scope: "disk" })}
            >
              <span className="ob-choice-title">Whole disk</span>
              <span className="ob-choice-desc">
                Any absolute path is accepted. The workspace is only the
                starting point.
              </span>
            </button>
          </div>
        </div>

        {source === "keys" && (
          <>
            <div className="field">
              <span className="field-label">Tools</span>
              <div
                className="ob-choice"
                role="radiogroup"
                aria-label="Tool execution mode"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={(value.permissionMode ?? "ask") === "ask"}
                  className={`ob-choice-btn${(value.permissionMode ?? "ask") === "ask" ? " is-on" : ""}`}
                  onClick={() => set({ permissionMode: "ask" })}
                >
                  <span className="ob-choice-title">
                    Ask before acting
                  </span>
                  <span className="ob-choice-desc">
                    Every shell command and every file change waits for
                    your permission.
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.permissionMode === "skip"}
                  className={`ob-choice-btn${value.permissionMode === "skip" ? " is-on" : ""}`}
                  onClick={() => set({ permissionMode: "skip" })}
                >
                  <span className="ob-choice-title">Direct execution</span>
                  <span className="ob-choice-desc">
                    Every tool runs without asking. Faster, with no safety
                    net. Orders, closes and transfers on an exchange still
                    ask.
                  </span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* For ALL agents, by key or by subscription: subscription agents
            receive the same tools through the MCP server. */}
        <div className="field">
          <span className="field-label">Exchange accounts</span>
          {exchanges.length === 0 ? (
            <p className="field-hint">Add an account in Settings → Auth so this agent can trade.</p>
          ) : (
            <>
              <p className="field-hint">The accounts this agent can read and drive. None: no exchange tool.</p>
              <div className="xch-pick">
                {exchanges.map((a) => (
                  <label key={a.id}>
                    <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                    <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
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
