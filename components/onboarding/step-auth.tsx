"use client";

import { useState } from "react";
import type { ApiKeys, AuthMode } from "@/lib/domain/types";
import { ACP_AGENTS, type AcpAgentId, type AcpAuthStatus } from "@/lib/acp/agents";
import { acpInstall, acpLogin, acpLogout, useAcpAuth } from "@/lib/acp/use-auth";
import { Field } from "@/components/ui/field";
import { Check, Eye, EyeOff, Spinner } from "@/components/ui/icons";
import type { StepErrors } from "./wizard";
import { ExchangeAccounts } from "./exchange-accounts";

type Props = {
  mode: AuthMode;
  keys: ApiKeys;
  errors: StepErrors;
  onMode: (mode: AuthMode) => void;
  onKeys: (keys: ApiKeys) => void;
};

/* ---------------------------------------------------------------------------
   Authentication: two ways to access the models.

   By SUBSCRIPTION — the Claude, ChatGPT or Google account you already have;
   sign in once, the vendor's agent (Claude Code, Codex, Gemini CLI) runs
   under BytNode-AI, with no extra token. By KEYS — an OpenRouter key gives
   every vendor at once, billed per use. The two coexist: each agent picks
   its provider. BytNode, the data source, is a key in both cases.
--------------------------------------------------------------------------- */
export function StepAuth({ mode, keys, errors, onMode, onKeys }: Props) {
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        Authentication
      </h1>
      <p className="ob-lede">
        Your agents need access to the models — your subscription, or a key — and a BytNode key for market data. Everything stays on this computer.
      </p>

      <div className="ob-tabs" role="tablist" aria-label="Authentication mode">
        <button type="button" role="tab" aria-selected={mode === "subscription"} className={`ob-tab${mode === "subscription" ? " is-on" : ""}`} onClick={() => onMode("subscription")}>
          Subscription
        </button>
        <button type="button" role="tab" aria-selected={mode === "keys"} className={`ob-tab${mode === "keys" ? " is-on" : ""}`} onClick={() => onMode("keys")}>
          Keys
        </button>
      </div>

      <div className="ob-form" role="tabpanel">
        {mode === "subscription" ? (
          <div className="field">
            <span className="field-label">Your subscription</span>
            <Subscriptions error={errors.subscription} />
          </div>
        ) : (
          <OpenRouterKey value={keys.openrouter} error={errors.openrouter} onChange={(openrouter) => onKeys({ ...keys, openrouter })} />
        )}

        <div className="ob-sub">
          <BytnodeKey value={keys.bytnode} error={errors.bytnode} onChange={(bytnode) => onKeys({ ...keys, bytnode })} />
        </div>

        <div className="ob-sub">
          <ExchangeAccounts value={keys.exchanges} onChange={(exchanges) => onKeys({ ...keys, exchanges })} />
        </div>
      </div>
    </>
  );
}

/* --- Subscriptions -------------------------------------------------------- */

export function Subscriptions({ error }: { error?: string }) {
  const auth = useAcpAuth();
  const [busy, setBusy] = useState<AcpAgentId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const status = (id: AcpAgentId): AcpAuthStatus => auth.agents.find((a) => a.agent === id) ?? { agent: id, available: false, loggedIn: false };

  const login = async (id: AcpAgentId) => {
    setBusy(id);
    setFailure(null);
    const msg = await acpLogin(id);
    if (msg) setFailure(msg);
    setBusy(null);
  };
  const install = async (id: AcpAgentId) => {
    setBusy(id);
    setFailure(null);
    const msg = await acpInstall(id);
    if (msg) setFailure(msg);
    setBusy(null);
  };
  const logout = async (id: AcpAgentId) => {
    setBusy(id);
    setFailure(null);
    const msg = await acpLogout(id);
    if (msg) setFailure(msg);
    setBusy(null);
  };

  return (
    <>
      <div className="subs">
        {ACP_AGENTS.map((a) => {
          const s = status(a.id);
          const loading = auth.status === "loading" || auth.status === "idle" || s.checking === true;
          return (
            <div key={a.id} className={`sub${s.loggedIn ? " is-on" : ""}`}>
              <div className="sub-main">
                <span className="sub-name">{a.label}</span>
                <span className="sub-desc">
                  {loading
                    ? "Reading…"
                    : s.installing
                      ? s.available
                        ? `Updating ${a.product} to its latest version…`
                        : `Installing ${a.product}… (a few minutes)`
                      : !s.available
                        ? (s.message ?? `${a.plan} · via ${a.product}, to install`)
                        : s.loggedIn
                          ? `Signed in${s.account ? ` · ${s.account}` : ""}${s.source === "global" ? " · CLI detected" : ""}`
                          : s.connecting
                            ? "Signing in — finish in the window that opened, then come back here."
                            : `${a.plan} · via ${a.product}${s.source === "global" ? " (detected on this machine)" : ""}`}
                </span>
              </div>
              {!s.available ? (
                <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing || loading} onClick={() => void install(a.id)}>
                  {busy === a.id || s.installing ? <Spinner /> : null}
                  {s.installing ? "Installing" : "Install"}
                </button>
              ) : (
                <>
                  {s.outdated ? (
                    <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing} onClick={() => void install(a.id)}>
                      {busy === a.id || s.installing ? <Spinner /> : null}
                      {s.installing ? "Updating" : "Update"}
                    </button>
                  ) : null}
                  {s.loggedIn ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => void logout(a.id)}>
                      {busy === a.id ? <Spinner /> : null}
                      Sign out
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === a.id || loading} onClick={() => void login(a.id)}>
                      {busy === a.id || s.connecting ? <Spinner /> : null}
                      {s.connecting ? "Waiting" : "Sign in"}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {(error ?? failure ?? (auth.status === "error" ? auth.message : null)) && (
        <p className="field-error">{error ?? failure ?? auth.message}</p>
      )}
      <p className="field-hint">
        Signing in opens the browser on the vendor&apos;s page (and, for Claude and GitHub Copilot, a terminal window).
        No key is created: your subscription is what gets used, with its usual limits. Missing agents
        install into ~/.bytnode-ai/agents on the first click; an agent already installed on the machine is recognised.
      </p>
    </>
  );
}

/* --- Keys ----------------------------------------------------------------- */

type KeyProps = { value: string; error?: string; onChange: (value: string) => void };

/** The BytNode console page where the key is created and copied. The route
    is French on the deployed site (`/console/cles`) and must stay so. */
export const BYTNODE_CONSOLE_KEYS = "https://bytnode.com/console/cles";

export function OpenRouterKey({ value, error, onChange }: KeyProps) {
  return (
    <KeyField
      id="openrouter"
      label="OpenRouter key"
      value={value}
      error={error}
      placeholderHint="Starts with sk-or-. Create it on openrouter.ai/keys. Gives access to every vendor, billed per use."
      verify={async (key) => {
        const res = await fetch("/api/openrouter/key", { headers: { "x-openrouter-key": key } });
        const json = (await res.json()) as { ok?: boolean; label?: string | null; error?: { message?: string } };
        return res.ok && json.ok ? { ok: true, label: json.label ?? null } : { ok: false, message: json.error?.message ?? "Key refused." };
      }}
      onChange={onChange}
    />
  );
}

export function BytnodeKey({ value, error, onChange }: KeyProps) {
  return (
    <KeyField
      id="bytnode"
      label="BytNode key"
      value={value}
      error={error}
      placeholderHint="Starts with mk_. Required: without it, the agents have no market data."
      link={{ href: BYTNODE_CONSOLE_KEYS, label: "Create or copy my key in the BytNode console" }}
      verify={async (key) => {
        const res = await fetch("/api/bytnode/key", { headers: { "x-bytnode-key": key } });
        const json = (await res.json()) as { ok?: boolean; tools?: string[]; error?: { message?: string } };
        const n = json.tools?.length ?? 0;
        return res.ok && json.ok
          ? { ok: true, label: `${n} data tool${n > 1 ? "s" : ""}` }
          : { ok: false, message: json.error?.message ?? "Key refused." };
      }}
      onChange={onChange}
    />
  );
}

type Check = { state: "idle" } | { state: "checking" } | { state: "ok"; label: string | null } | { state: "bad"; message: string };

type KeyFieldProps = {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  error?: string;
  placeholderHint: string;
  verify: (key: string) => Promise<{ ok: true; label: string | null } | { ok: false; message: string }>;
  onChange: (value: string) => void;
  link?: { href: string; label: string };
};

export function KeyField({ id, label, optional, value, error, placeholderHint, verify, onChange, link }: KeyFieldProps) {
  const [shown, setShown] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });

  const run = async () => {
    const key = value.trim();
    if (!key) return;
    setCheck({ state: "checking" });
    try {
      const r = await verify(key);
      setCheck(r.ok ? { state: "ok", label: r.label } : { state: "bad", message: r.message });
    } catch {
      setCheck({ state: "bad", message: "Could not reach the service." });
    }
  };

  return (
    <Field
      id={id}
      label={label}
      optional={optional}
      link={link}
      error={error ?? (check.state === "bad" ? check.message : null)}
      hint={check.state === "ok" ? `Key recognised${check.label ? `: ${check.label}` : ""}.` : placeholderHint}
    >
      <div className="ob-key">
        <input
          id={id}
          className="field-input mono"
          type={shown ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCheck({ state: "idle" });
          }}
        />
        <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? "Hide the key" : "Show the key"}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
        <button type="button" className={`btn btn-sm${check.state === "ok" ? " is-ok" : ""}`} onClick={run} disabled={!value.trim() || check.state === "checking"}>
          {check.state === "checking" ? <Spinner /> : check.state === "ok" ? <Check /> : null}
          {check.state === "ok" ? "Verified" : "Verify"}
        </button>
      </div>
    </Field>
  );
}
