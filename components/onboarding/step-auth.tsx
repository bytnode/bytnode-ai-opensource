"use client";

import { useState } from "react";
import { ACP_AGENTS, type AcpAgentId, type AcpAuthStatus } from "@/lib/acp/agents";
import { acpInstall, acpLogin, acpLoginCancel, acpLoginCode, acpLogout, useAcpAuth } from "@/lib/acp/use-auth";
import { Field } from "@/components/ui/field";
import { Check, Eye, EyeOff, Spinner } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";

/* The bricks of the models' step (`wizard.tsx`) and of the settings'
   Authentication tab: the subscriptions, the OpenRouter and BytNode keys.
   The BytNode key is not asked in the desktop app, which makes its own at
   sign-in (`lib/account/account.ts`). */

/* --- Subscriptions -------------------------------------------------------- */

export function Subscriptions({ error }: { error?: string }) {
  const m = useMessages();
  const t = m.onboarding.auth;
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
          const plan = t.plans[a.id];
          const loading = auth.status === "loading" || auth.status === "idle" || s.checking === true;
          return (
            <div key={a.id} className="sub-wrap">
            <div className={`sub${s.loggedIn ? " is-on" : ""}`}>
              <div className="sub-main">
                <span className="sub-name">{a.label}</span>
                <span className="sub-desc">
                  {loading
                    ? t.reading
                    : s.installing
                      ? s.available
                        ? t.updating(a.product)
                        : t.installing(a.product)
                      : !s.available
                        ? (s.message ?? t.toInstall(plan, a.product))
                        : s.loggedIn
                          ? t.signedIn(s.account ?? "", s.source === "global")
                          : s.signIn
                            ? s.signIn.error
                              ? t.signInFailed
                              : t.signingInCode
                            : s.connecting
                            ? t.signingInWindow
                            : t.plan(plan, a.product, s.source === "global")}
                </span>
              </div>
              {!s.available ? (
                <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing || loading} onClick={() => void install(a.id)}>
                  {busy === a.id || s.installing ? <Spinner /> : null}
                  {s.installing ? t.installingButton : t.install}
                </button>
              ) : (
                <>
                  {s.outdated ? (
                    <button type="button" className="btn btn-sm" disabled={busy === a.id || s.installing} onClick={() => void install(a.id)}>
                      {busy === a.id || s.installing ? <Spinner /> : null}
                      {s.installing ? t.updatingButton : t.update}
                    </button>
                  ) : null}
                  {s.loggedIn ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => void logout(a.id)}>
                      {busy === a.id ? <Spinner /> : null}
                      {t.signOut}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === a.id || loading} onClick={() => void login(a.id)}>
                      {busy === a.id || s.connecting ? <Spinner /> : null}
                      {s.connecting ? t.waiting : s.signIn?.error ? m.common.retry : t.signIn}
                    </button>
                  )}
                </>
              )}
            </div>
            {s.signIn && !s.loggedIn ? <SignInCode agent={a.id} product={a.product} signIn={s.signIn} /> : null}
            </div>
          );
        })}
      </div>
      {(error ?? failure ?? (auth.status === "error" ? auth.message : null)) && (
        <p className="field-error">{error ?? failure ?? auth.message}</p>
      )}
      <p className="field-hint">{t.subscriptionsHint}</p>
    </>
  );
}

/* The code step of Claude's sign-in, in the app (user request: no terminal
   to paste it in). The browser page shows a code once the account is
   chosen; it goes to `claude auth login`, which the server runs
   (`lib/acp/claude-login.ts`). When the browser hands the code back by
   itself, the sign-in ends without it and this block goes away. */
function SignInCode({ agent, product, signIn }: { agent: AcpAgentId; product: string; signIn: NonNullable<AcpAuthStatus["signIn"]> }) {
  const m = useMessages();
  const t = m.onboarding.auth;
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const send = async () => {
    setSending(true);
    setRefused(null);
    const msg = await acpLoginCode(agent, code);
    setSending(false);
    if (msg) setRefused(msg);
    else setCode("");
  };
  const waiting = sending || signIn.checking;
  const message = refused ?? signIn.error;
  return (
    <div className="sub-signin">
      <p className="sub-signin-text">
        {t.codeText}
        {signIn.url ? (
          <>
            {" "}
            <a href={signIn.url} target="_blank" rel="noreferrer">
              {t.browserDidNotOpen}
            </a>
          </>
        ) : null}
      </p>
      {!signIn.error || refused ? (
        <form
          className="ob-key"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() && !waiting) void send();
          }}
        >
          <input
            className="field-input mono"
            placeholder={t.codePlaceholder(product)}
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={t.codeLabel(product)}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!code.trim() || waiting}>
            {waiting ? <Spinner /> : null}
            {waiting ? t.checking : t.continue}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void acpLoginCancel(agent)}>
            {m.common.cancel}
          </button>
        </form>
      ) : null}
      {message ? <p className="field-error">{message}</p> : null}
    </div>
  );
}

/* --- Keys ----------------------------------------------------------------- */

type KeyProps = { value: string; error?: string; optional?: boolean; onChange: (value: string) => void };

/** The BytNode dashboard page where the key is created and copied. The
    site's routes are English since 2026-09-25: the old `/console/cles`
    redirected to `/dashboard/cles`, a 404 (user report, 2026-10-07). */
export const BYTNODE_CONSOLE_KEYS = "https://bytnode.com/dashboard/keys";

export function OpenRouterKey({ value, error, optional, onChange }: KeyProps) {
  const t = useMessages().onboarding.auth;
  return (
    <KeyField
      id="openrouter"
      label={t.openrouterLabel}
      optional={optional}
      value={value}
      error={error}
      placeholderHint={t.openrouterHint}
      link={{ href: "https://openrouter.ai/keys", label: t.openrouterLink, button: true }}
      verify={async (key) => {
        const res = await fetch("/api/openrouter/key", { headers: { "x-openrouter-key": key } });
        const json = (await res.json()) as { ok?: boolean; label?: string | null; error?: { message?: string } };
        return res.ok && json.ok ? { ok: true, label: json.label ?? null } : { ok: false, message: json.error?.message ?? t.keyRefused };
      }}
      onChange={onChange}
    />
  );
}

export function BytnodeKey({ value, error, onChange }: KeyProps) {
  const t = useMessages().onboarding.auth;
  return (
    <KeyField
      id="bytnode"
      label={t.bytnodeLabel}
      value={value}
      error={error}
      placeholderHint={t.bytnodeHint}
      link={{ href: BYTNODE_CONSOLE_KEYS, label: t.bytnodeLink }}
      verify={async (key) => {
        const res = await fetch("/api/bytnode/key", { headers: { "x-bytnode-key": key } });
        const json = (await res.json()) as { ok?: boolean; pairs?: number; error?: { message?: string } };
        const n = json.pairs ?? 0;
        return res.ok && json.ok
          ? { ok: true, label: t.dataPairs(n) }
          : { ok: false, message: json.error?.message ?? t.keyRefused };
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
  link?: { href: string; label: string; button?: boolean };
};

export function KeyField({ id, label, optional, value, error, placeholderHint, verify, onChange, link }: KeyFieldProps) {
  const t = useMessages().onboarding.auth;
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
      setCheck({ state: "bad", message: t.unreachable });
    }
  };

  return (
    <Field
      id={id}
      label={label}
      optional={optional}
      link={link}
      error={error ?? (check.state === "bad" ? check.message : null)}
      hint={check.state === "ok" ? t.recognised(check.label ?? "") : placeholderHint}
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
        <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? t.hideKey : t.showKey}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
        <button type="button" className={`btn btn-sm${check.state === "ok" ? " is-ok" : ""}`} onClick={run} disabled={!value.trim() || check.state === "checking"}>
          {check.state === "checking" ? <Spinner /> : check.state === "ok" ? <Check /> : null}
          {check.state === "ok" ? t.verified : t.verify}
        </button>
      </div>
    </Field>
  );
}
