"use client";

import { useState } from "react";
import { byPopularity, searchProviders } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import { ACP_AGENTS, isAcpProvider, type AcpAgentId } from "@/lib/acp/agents";
import { acpInstall, acpLogin, useAcpAuth } from "@/lib/acp/use-auth";
import { Check, Search, Spinner } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";

export type ProviderSource = "subscription" | "keys";

type Props = {
  id: string;
  value: string;
  /** What we list: the subscriptions (Claude, OpenAI… — a sign-in
      or an install first when needed) or the vendors present on
      OpenRouter, with a search. */
  source: ProviderSource;
  onChange: (providerId: string) => void;
};

/* The provider choice, IN the form (user request, 2026-10-08): the same
   cards as « Access to the models » and « Profession », not a floating
   list — that one did not look like the rest, and the settings panel cut
   it off at its bottom edge. The subscriptions are four cards; the
   OpenRouter vendors, a search over a list that scrolls in place. */
export function ProviderPicker({ id, value, source, onChange }: Props) {
  return source === "subscription" ? <Subscriptions id={id} value={value} onChange={onChange} /> : <Vendors id={id} value={value} onChange={onChange} />;
}

function Subscriptions({ id, value, onChange }: Omit<Props, "source">) {
  const m = useMessages();
  const t = m.onboarding.picker;
  const auth = m.onboarding.auth;
  const acp = useAcpAuth();
  const [busy, setBusy] = useState<AcpAgentId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /* Sign in (or install) from the card: it becomes a choice as soon as
     the state says « signed in ». */
  const act = async (agent: AcpAgentId, install: boolean) => {
    setBusy(agent);
    setFailure(null);
    const msg = await (install ? acpInstall(agent) : acpLogin(agent));
    if (msg) setFailure(msg);
    setBusy(null);
  };
  return (
    <>
      <div className="pv-subs" id={id} role="radiogroup" aria-label={m.onboarding.agent.subscription}>
        {ACP_AGENTS.map((a) => {
          const st = acp.agents.find((x) => x.agent === a.id);
          const loading = acp.status === "loading" || acp.status === "idle" || st?.checking === true;
          const on = a.providerId === value;
          if (st?.loggedIn) {
            return (
              <button key={a.id} type="button" role="radio" aria-checked={on} className={`ob-choice-btn pv-row${on ? " is-on" : ""}`} onClick={() => onChange(a.providerId)}>
                <span className="pv-row-text">
                  <span className="ob-choice-title">{a.label}</span>
                  <span className="ob-choice-desc">
                    {st.account ? t.viaAccount(st.account, a.product) : t.via(a.product)}
                  </span>
                </span>
                {on ? <Check className="pv-check" /> : null}
              </button>
            );
          }
          const toInstall = !!st && !st.available;
          const waiting = busy === a.id || !!st?.connecting || !!st?.installing;
          const desc = loading
            ? auth.reading
            : st?.installing
              ? t.installing(a.product)
              : st?.connecting
                ? t.signingIn
                : st && !st.available && !toInstall
                  ? (st.message ?? t.unavailable)
                  : auth.plan(auth.plans[a.id], a.product, false);
          return (
            <div key={a.id} className="ob-choice-btn pv-row is-off">
              <span className="pv-row-text">
                <span className="ob-choice-title">{a.label}</span>
                <span className="ob-choice-desc">{desc}</span>
              </span>
              <button
                type="button"
                className={`btn btn-sm${toInstall ? "" : " btn-primary"}`}
                disabled={loading || waiting || (!!st && !st.available && !toInstall)}
                onClick={() => void act(a.id, toInstall)}
              >
                {waiting ? <Spinner /> : null}
                {st?.installing ? auth.installingButton : st?.connecting ? auth.waiting : toInstall ? auth.install : auth.signIn}
              </button>
            </div>
          );
        })}
      </div>
      {failure && <p className="field-error">{failure}</p>}
    </>
  );
}

function Vendors({ id, value, onChange }: Omit<Props, "source">) {
  const m = useMessages();
  const t = m.onboarding.picker;
  const [query, setQuery] = useState("");
  const catalog = useCatalog();
  /* By popularity, not alphabetical (user request). */
  const results = byPopularity(searchProviders(catalog.providers, query).filter((p) => !isAcpProvider(p.id)));
  return (
    <div className="pv-vendors">
      <label className="pv-search">
        <Search />
        <input id={id} className="pv-search-input" placeholder={t.searchVendor} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      {catalog.status === "loading" || catalog.status === "idle" ? (
        <p className="pv-empty">{t.readingCatalog}</p>
      ) : catalog.status === "error" ? (
        <p className="pv-empty">
          {catalog.message}{" "}
          <button type="button" className="btn btn-sm" onClick={() => loadCatalog(true)}>
            {t.reload}
          </button>
        </p>
      ) : results.length === 0 ? (
        <p className="pv-empty">{t.noVendor(query)}</p>
      ) : (
        <div className="pv-list" role="radiogroup" aria-label={m.onboarding.agent.vendor}>
          {results.map((p) => {
            const on = p.id === value;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} className={`ob-choice-btn pv-row${on ? " is-on" : ""}`} onClick={() => onChange(p.id)}>
                <span className="pv-row-text">
                  <span className="ob-choice-title">{p.name}</span>
                  <span className="ob-choice-desc mono">{p.id}</span>
                </span>
                {on ? (
                  <Check className="pv-check" />
                ) : (
                  <span className="pv-count">
                    {t.models(p.modelCount)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
