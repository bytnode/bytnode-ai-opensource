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
   Authentification : deux facons d'acceder aux modeles.

   Par ABONNEMENT — le compte Claude, ChatGPT ou Google qu'on a deja ; on
   se connecte une fois, l'agent de l'editeur (Claude Code, Codex, Gemini
   CLI) tourne sous BytNode-AI, sans jeton supplementaire. Par CLES — une
   cle OpenRouter donne tous les editeurs a la fois, facturee a l'usage.
   Les deux coexistent : chaque agent choisit son fournisseur. BytNode, la
   source de donnees, est une cle dans les deux cas.
--------------------------------------------------------------------------- */
export function StepAuth({ mode, keys, errors, onMode, onKeys }: Props) {
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        Authentification
      </h1>
      <p className="ob-lede">
        Vos agents ont besoin d&apos;un accès aux modèles : votre abonnement, ou une clé. Tout reste sur cet ordinateur.
      </p>

      <div className="ob-tabs" role="tablist" aria-label="Mode d'authentification">
        <button type="button" role="tab" aria-selected={mode === "subscription"} className={`ob-tab${mode === "subscription" ? " is-on" : ""}`} onClick={() => onMode("subscription")}>
          Abonnement
        </button>
        <button type="button" role="tab" aria-selected={mode === "keys"} className={`ob-tab${mode === "keys" ? " is-on" : ""}`} onClick={() => onMode("keys")}>
          Clés
        </button>
      </div>

      <div className="ob-form" role="tabpanel">
        {mode === "subscription" ? (
          <div className="field">
            <span className="field-label">Votre abonnement</span>
            <Subscriptions error={errors.subscription} />
          </div>
        ) : (
          <OpenRouterKey value={keys.openrouter} error={errors.openrouter} onChange={(openrouter) => onKeys({ ...keys, openrouter })} />
        )}

        <div className="ob-sub">
          <BytnodeKey value={keys.bytnode} onChange={(bytnode) => onKeys({ ...keys, bytnode })} />
        </div>

        <div className="ob-sub">
          <ExchangeAccounts value={keys.exchanges} onChange={(exchanges) => onKeys({ ...keys, exchanges })} />
        </div>
      </div>
    </>
  );
}

/* --- Abonnements ---------------------------------------------------------- */

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
    await acpLogout(id);
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
                    ? "Lecture…"
                    : s.installing
                      ? `Installation de ${a.product}… (quelques minutes)`
                      : !s.available
                        ? (s.message ?? `${a.plan} · via ${a.product}, à installer`)
                        : s.loggedIn
                          ? `Connecté${s.account ? ` · ${s.account}` : ""}${s.source === "global" ? " · CLI détecté" : ""}`
                          : s.connecting
                            ? "Connexion en cours — terminez dans la fenêtre ouverte, puis revenez ici."
                            : `${a.plan} · via ${a.product}${s.source === "global" ? " (détecté sur cette machine)" : ""}`}
                </span>
              </div>
              {!s.available ? (
                <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing || loading} onClick={() => void install(a.id)}>
                  {busy === a.id || s.installing ? <Spinner /> : null}
                  {s.installing ? "Installation" : "Installer"}
                </button>
              ) : (
                <>
                  {s.outdated ? (
                    <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing} onClick={() => void install(a.id)}>
                      {busy === a.id || s.installing ? <Spinner /> : null}
                      {s.installing ? "Mise à jour" : "Mettre à jour"}
                    </button>
                  ) : null}
                  {s.loggedIn ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => void logout(a.id)}>
                      {busy === a.id ? <Spinner /> : null}
                      Se déconnecter
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === a.id || loading} onClick={() => void login(a.id)}>
                      {busy === a.id || s.connecting ? <Spinner /> : null}
                      {s.connecting ? "En attente" : "Se connecter"}
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
        Se connecter ouvre le navigateur sur la page de l&apos;éditeur (et, pour Claude et GitHub Copilot, une fenêtre de terminal).
        Aucune clé n&apos;est créée : c&apos;est votre abonnement qui est utilisé, avec ses limites habituelles. Les agents
        absents s&apos;installent dans ~/.bytnode-ai/agents au premier clic ; un agent déjà installé sur la machine est reconnu.
      </p>
    </>
  );
}

/* --- Cles ----------------------------------------------------------------- */

type KeyProps = { value: string; error?: string; onChange: (value: string) => void };

export function OpenRouterKey({ value, error, onChange }: KeyProps) {
  return (
    <KeyField
      id="openrouter"
      label="Clé OpenRouter"
      value={value}
      error={error}
      placeholderHint="Commence par sk-or-. Créez-la sur openrouter.ai/keys. Donne accès à tous les éditeurs, facturé à l'usage."
      verify={async (key) => {
        const res = await fetch("/api/openrouter/key", { headers: { "x-openrouter-key": key } });
        const json = (await res.json()) as { ok?: boolean; label?: string | null; error?: { message?: string } };
        return res.ok && json.ok ? { ok: true, label: json.label ?? null } : { ok: false, message: json.error?.message ?? "Clé refusée." };
      }}
      onChange={onChange}
    />
  );
}

export function BytnodeKey({ value, onChange }: KeyProps) {
  return (
    <KeyField
      id="bytnode"
      label="Clé BytNode"
      optional
      value={value}
      placeholderHint="Commence par mk_. Depuis votre console BytNode, page Clés. Sans elle, les agents n'ont pas de données de marché."
      verify={async (key) => {
        const res = await fetch("/api/bytnode/key", { headers: { "x-bytnode-key": key } });
        const json = (await res.json()) as { ok?: boolean; tools?: string[]; error?: { message?: string } };
        const n = json.tools?.length ?? 0;
        return res.ok && json.ok
          ? { ok: true, label: `${n} outil${n > 1 ? "s" : ""} de données` }
          : { ok: false, message: json.error?.message ?? "Clé refusée." };
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
};

export function KeyField({ id, label, optional, value, error, placeholderHint, verify, onChange }: KeyFieldProps) {
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
      setCheck({ state: "bad", message: "Impossible de joindre le service." });
    }
  };

  return (
    <Field
      id={id}
      label={label}
      optional={optional}
      error={error ?? (check.state === "bad" ? check.message : null)}
      hint={check.state === "ok" ? `Clé reconnue${check.label ? ` : ${check.label}` : ""}.` : placeholderHint}
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
        <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? "Masquer la clé" : "Afficher la clé"}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
        <button type="button" className={`btn btn-sm${check.state === "ok" ? " is-ok" : ""}`} onClick={run} disabled={!value.trim() || check.state === "checking"}>
          {check.state === "checking" ? <Spinner /> : check.state === "ok" ? <Check /> : null}
          {check.state === "ok" ? "Vérifiée" : "Vérifier"}
        </button>
      </div>
    </Field>
  );
}
