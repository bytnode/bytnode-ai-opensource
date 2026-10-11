"use client";

import { useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { decideUserPlugin } from "@/lib/plugins/client";
import { describePermissions } from "@/lib/plugins/user/permissions";
import { refreshUserPlugins, useUserPlugins } from "@/lib/state/user-plugins";
import { openView } from "@/lib/state/tabs";
import { Check, Spinner } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";

/* ---------------------------------------------------------------------------
   The user's consent to a plugin written by an agent — shown IN THE
   CONVERSATION, under the agent's PluginActivate (and in the library's
   review window, the same block).

   What it is, who wrote it, what it adds, and above all what it may reach,
   in plain words. When it asks for the exchange accounts, the choice is
   made like an order's: TESTNET or LIVE first — Live in red, saying what
   real access means (reading the real account; proposing real-money
   orders, each still confirmed by a click) — then the accounts of that
   kind. The server grants exactly the request the block shows (its
   digest), never more; the plugin never sees a key either way.
   Once decided, the block stays in the thread as a record.
--------------------------------------------------------------------------- */

type Mode = "testnet" | "live";

/** `digest`: the version this block was shown for (the card under the
    agent's PluginActivate); absent in the library, which shows the current
    request. */
export function PluginConsent({ pluginId, digest, settings, onDecided }: { pluginId: string; digest?: string; settings: Settings; onDecided?: () => void }) {
  const m = useMessages();
  const t = m.plugins.consent;
  const plugins = useUserPlugins();
  const [mode, setMode] = useState<Mode | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"active" | "refused" | null>(null);

  const p = plugins.find((x) => x.id === pluginId);
  const request = p?.request ?? null;
  /* A newer request (the agent changed it again) is answered below, not here. */
  const superseded = Boolean(request && digest && request.digest !== digest);
  const r = superseded ? null : request;
  const agent = (id: string) => settings.agents.find((a) => a.id === id)?.name || t.anAgent;
  const all = settings.keys.exchanges;
  const test = all.filter((a) => a.testnet);
  const live = all.filter((a) => !a.testnet);
  const shown = mode === "live" ? live : mode === "testnet" ? test : [];

  const choose = (m: Mode) => {
    setMode(m);
    const list = m === "live" ? live : test;
    setPicked(list.length === 1 ? [list[0].id] : []);
  };

  const decide = async (allow: boolean) => {
    if (!p || !r) return;
    setBusy(true);
    setError(null);
    try {
      await decideUserPlugin(p.id, r.digest, allow, allow ? picked : []);
      setDone(allow ? "active" : "refused");
      await refreshUserPlugins();
      onDecided?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!p) return <div className="pcs">{plugins.length ? t.gone : <Spinner />}</div>;

  /* Decided: the record stays in the thread. */
  if (superseded && !done)
    return (
      <div className="pcs pcs-done">
        <span className="pcs-done-text">
          {t.changed(p.name)}
          <small>{t.newerBelow}</small>
        </span>
      </div>
    );

  if (!r || done) {
    const on = done === "active" || (done === null && p.granted && p.state !== "draft");
    const accounts = p.granted?.accounts.map((id) => all.find((a) => a.id === id)).filter((a) => a !== undefined) ?? [];
    return (
      <div className={`pcs pcs-done${on ? " is-on" : ""}`}>
        <span className="pcs-done-text">
          {on ? <Check /> : null}
          {on ? t.active(p.name) : t.notActivated(p.name)}
          {on && accounts.length > 0 && (
            <span className="pcs-done-accounts">
              {accounts.map((a) => (
                <span key={a.id} className={`xch-badge${a.testnet ? "" : " is-live"}`}>
                  {a.testnet ? "TESTNET" : "LIVE"}
                </span>
              ))}
              {accounts.map((a) => a.label).join(", ")}
            </span>
          )}
          {!on && <small>{t.refused}</small>}
        </span>
        {on && p.manifest?.views.length ? (
          <button type="button" className="btn btn-sm" onClick={() => openView(p.id)}>
            {t.openTab}
          </button>
        ) : null}
      </div>
    );
  }

  const updating = Boolean(p.granted);
  const lines = describePermissions(r.permissions, m);
  const fresh = new Set(describePermissions(r.added, m).map((l) => l.key));
  const exchange = r.permissions.exchange;
  const needsAccounts = exchange !== "none";
  const ready = !needsAccounts || (mode !== null && picked.length > 0);
  const real = mode === "live";
  /* Reading the real account commits no money: said in green. Proposing
     real-money orders stays red. */
  const safe = exchange === "read" ? " is-safe" : "";

  return (
    <div className={`pcs${real ? ` is-live${safe}` : ""}`} role="group" aria-label={t.groupLabel(r.manifest.name)}>
      <p className="pcs-title">
        {updating ? t.askUpdate(r.manifest.name) : t.askActivate(r.manifest.name)}
        <small>{t.writtenBy(agent(r.agentId || p.createdBy), r.manifest.summary)}</small>
      </p>

      <p className="pcs-label">{t.itMay}</p>
      {lines.length === 0 ? (
        <p className="pcs-none">{t.reachesNothing}</p>
      ) : (
        <ul className="pcs-list">
          {lines.map((l) => (
            <li key={l.key} className={l.danger ? "is-danger" : undefined}>
              {l.text}
              {updating && fresh.has(l.key) && <span className="prv-new">{t.isNew}</span>}
            </li>
          ))}
        </ul>
      )}

      {(r.tools.length > 0 || r.manifest.views.length > 0) && (
        <p className="pcs-adds">
          {t.adds([...r.tools.map((tool) => (tool.readOnly ? tool.name : t.toolAsks(tool.name))), ...r.manifest.views.map((v) => t.tab(v.title))])}
        </p>
      )}

      {needsAccounts && (
        <div className="pcs-accounts">
          <p className="pcs-label">{t.whichMoney}</p>
          {all.length === 0 ? (
            <p className="pcs-none">{t.noAccount}</p>
          ) : (
            <>
              <div className="pcs-modes" role="radiogroup" aria-label={t.testOrLive}>
                <button type="button" role="radio" aria-checked={mode === "testnet"} className={`pcs-mode${mode === "testnet" ? " is-on" : ""}`} onClick={() => choose("testnet")} disabled={test.length === 0}>
                  <span className="xch-badge">TESTNET</span>
                  <span>
                    {t.test}
                    <small>{test.length ? t.testHint : t.noTestnet}</small>
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={mode === "live"} className={`pcs-mode is-real${safe}${mode === "live" ? " is-on" : ""}`} onClick={() => choose("live")} disabled={live.length === 0}>
                  <span className="xch-badge is-live">LIVE</span>
                  <span>
                    {t.real}
                    <small>{live.length ? t.realHint : t.noLive}</small>
                  </span>
                </button>
              </div>
              {real && (
                <p className={`pcs-warn${safe}`}>
                  {exchange === "orders" ? t.warnOrders : t.warnRead}
                </p>
              )}
              {mode && (
                <div className="pcs-picks">
                  {shown.map((a) => (
                    <label key={a.id} className="prv-account">
                      <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked(picked.includes(a.id) ? picked.filter((x) => x !== a.id) : [...picked, a.id])} />
                      <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                      <span>{a.label}</span>
                      <small>{a.exchange}</small>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error && <p className="field-error">{error}</p>}
      <div className="pcs-actions">
        <button type="button" className={`btn btn-sm btn-primary${real ? ` pcs-real${safe}` : ""}`} onClick={() => void decide(true)} disabled={busy || !ready}>
          {busy ? <Spinner /> : null}
          {!needsAccounts ? (updating ? t.update : t.activate) : mode === "live" ? t.allowLive : mode === "testnet" ? t.allowTestnet : t.chooseMode}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void decide(false)} disabled={busy}>
          {t.refuse}
        </button>
      </div>
    </div>
  );
}
