"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { decideUserPlugin } from "@/lib/plugins/client";
import { describePermissions } from "@/lib/plugins/user/permissions";
import { closeReview, refreshUserPlugins, useReviewing, useUserPlugins } from "@/lib/state/user-plugins";
import { refreshNotifications } from "@/lib/state/plugins";
import { openView } from "@/lib/state/tabs";
import { Spinner } from "@/components/ui/icons";
import "@/components/ui/ui.css";

/* ---------------------------------------------------------------------------
   The review of a plugin written by an agent, before it runs — like a
   phone asking about an app's permissions.

   What it is (in the agent's words, checked), who wrote it, the tools it
   gives the agents and whether each one asks first, its tab, and above
   all WHAT IT MAY REACH, in plain words, the new ones marked when it is an
   update. When it asks for the exchange accounts, the user ticks which —
   none by default. Activate / Refuse / Later. The server grants exactly
   what this screen showed (its digest), or refuses if the plugin changed
   in between.
--------------------------------------------------------------------------- */

export function PluginReview({ settings }: { settings: Settings }) {
  const id = useReviewing();
  const plugins = useUserPlugins();
  const [accounts, setAccounts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"active" | "refused" | null>(null);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && closeReview();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, busy]);

  if (!id) return null;
  const p = plugins.find((x) => x.id === id);
  const r = p?.request ?? null;
  const agent = (agentId: string) => settings.agents.find((a) => a.id === agentId)?.name || "An agent";
  const close = () => {
    closeReview();
    setDone(null);
    setError(null);
    setAccounts([]);
  };

  const decide = async (allow: boolean) => {
    if (!p || !r) return;
    setBusy(true);
    setError(null);
    try {
      await decideUserPlugin(p.id, r.digest, allow, accounts);
      setDone(allow ? "active" : "refused");
      void refreshUserPlugins();
      void refreshNotifications();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updating = Boolean(p?.granted);
  const lines = r ? describePermissions(r.permissions) : [];
  const fresh = new Set(r ? describePermissions(r.added).map((l) => l.key) : []);
  const needsAccounts = r ? r.permissions.exchange !== "none" : false;

  return (
    <div className="cd" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="cd-sheet prv" role="alertdialog" aria-modal="true" aria-labelledby="prv-title">
        {done ? (
          <>
            <h2 id="prv-title" className="cd-title">
              {done === "active" ? `${p?.name ?? "The plugin"} is active` : "Refused"}
            </h2>
            <p className="cd-body">{done === "active" ? "Its tools reach your agents from their next message." : "Nothing runs. The agent can change it and ask again."}</p>
            <div className="cd-actions">
              {done === "active" && p?.manifest?.views.length ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    openView(p.id);
                    close();
                  }}
                >
                  Open its tab
                </button>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : !p || !r ? (
          <>
            <h2 id="prv-title" className="cd-title">
              Nothing to review
            </h2>
            <p className="cd-body">{p ? "This plugin does not wait for your approval any more: it was decided, or its agent changed it since." : "Loading…"}</p>
            <div className="cd-actions">
              <button type="button" className="btn btn-primary" onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="prv-title" className="cd-title">
              {updating ? `Update ${r.manifest.name}?` : `Activate ${r.manifest.name}?`}
            </h2>
            <p className="cd-body">
              {r.manifest.summary}
              <small className="prv-from">
                Written by {agent(r.agentId || p.createdBy)} · {new Date(r.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </small>
            </p>

            <div className="prv-block">
              <p className="prv-label">It may</p>
              {lines.length === 0 ? (
                <p className="prv-none">Reach nothing outside itself: no internet, no account, no notification.</p>
              ) : (
                <ul className="prv-perms">
                  {lines.map((l) => (
                    <li key={l.key} className={l.danger ? "is-danger" : undefined}>
                      {l.text}
                      {updating && fresh.has(l.key) && <span className="prv-new">New</span>}
                    </li>
                  ))}
                </ul>
              )}
              {needsAccounts && (
                <div className="prv-accounts">
                  <p className="prv-label">On these accounts only</p>
                  {settings.keys.exchanges.length === 0 ? (
                    <p className="prv-none">No exchange account is configured: add one in Settings → Auth first, or refuse.</p>
                  ) : (
                    settings.keys.exchanges.map((a) => (
                      <label key={a.id} className="prv-account">
                        <input type="checkbox" checked={accounts.includes(a.id)} onChange={() => setAccounts(accounts.includes(a.id) ? accounts.filter((x) => x !== a.id) : [...accounts, a.id])} />
                        <span className={`xch-badge${a.testnet ? "" : " is-live"}`}>{a.testnet ? "TESTNET" : "LIVE"}</span>
                        <span>{a.label}</span>
                        <small>{a.exchange}</small>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="prv-block">
              <p className="prv-label">It adds</p>
              <ul className="prv-adds">
                {r.tools.map((t) => (
                  <li key={t.name}>
                    <span className="mono">{t.name}</span>
                    <small>{t.readOnly ? "reads only, runs without asking" : "asks you before acting"}</small>
                  </li>
                ))}
                {r.manifest.views.map((v) => (
                  <li key={v.id}>
                    <span>The tab {v.title}</span>
                    <small>{v.description}</small>
                  </li>
                ))}
                {r.tools.length === 0 && r.manifest.views.length === 0 && <li>Background work only.</li>}
              </ul>
            </div>

            <p className="prv-safe">It runs in a closed box: it never sees your keys, reaches nothing it was not granted, and an order it proposes still waits for your click.</p>
            {error && <p className="field-error">{error}</p>}
            <div className="cd-actions">
              <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
                Later
              </button>
              <button type="button" className="btn" onClick={() => void decide(false)} disabled={busy}>
                Refuse
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void decide(true)} disabled={busy || (needsAccounts && accounts.length === 0)}>
                {busy ? <Spinner /> : null}
                {updating ? "Update" : "Activate"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
