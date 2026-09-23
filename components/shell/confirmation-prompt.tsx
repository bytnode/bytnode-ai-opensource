"use client";

import { useEffect, useState } from "react";
import type { Confirmation } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { decideConfirmation, fetchConfirmations } from "@/lib/plugins/client";
import { pluginManifest } from "@/lib/plugins/catalog";
import { refreshNotifications } from "@/lib/state/plugins";
import { summarizeCall } from "@/lib/tools/names";
import { ExchangeBadge } from "@/components/chat/tool-step";
import { Spinner } from "@/components/ui/icons";
import "@/components/ui/ui.css";

/* ---------------------------------------------------------------------------
   A plugin's parked order, in front of the user.

   The same permission prompt as in the thread: the tool, the order in one
   line, the LIVE / TESTNET badge of the account, "This action commits
   funds", Allow and Deny — never "Always". Allow sends the decision with
   the targeted account (from this browser's settings); the server runs
   the core tool once and says what happened.
--------------------------------------------------------------------------- */

type Props = { confirmationId: string; settings: Settings; onClose: () => void };

export function ConfirmationPrompt({ confirmationId, settings, onClose }: Props) {
  const [c, setC] = useState<Confirmation | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchConfirmations()
      .then((list) => alive && setC(list.find((x) => x.id === confirmationId) ?? null))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [confirmationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const account = c ? settings.keys.exchanges.find((a) => a.id === c.accountId) : undefined;

  const decide = async (allow: boolean) => {
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      setC(await decideConfirmation(c.id, allow, { exchangeAccounts: account ? [account] : [] }));
      void refreshNotifications();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cd" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cd-sheet cf" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
        {c === undefined ? (
          <p className="cd-body">
            <Spinner /> Loading…
          </p>
        ) : c === null ? (
          <>
            <h2 id="cf-title" className="cd-title">
              Request not found
            </h2>
            <p className="cd-body">It was already decided, or it expired.</p>
            <div className="cd-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="cf-title" className="cd-title">
              {c.title}
            </h2>
            <p className="cd-body">
              {c.reason}
              <small className="cf-from">Prepared by {pluginManifest(c.plugin)?.name ?? c.plugin}</small>
            </p>
            <div className={`cf-call${c.status === "pending" ? " is-danger" : ""}`}>
              <ExchangeBadge account={account?.label} />
              <span className="ts-name">{c.tool}</span>
              <span className="mono">{summarizeCall(c.tool, { ...c.args, account: account?.label ?? "unknown account" })}</span>
            </div>
            {c.status === "pending" ? (
              <>
                <p className="cf-warn">{account ? "This action commits funds. Allow it once, knowingly." : "The account of this order is no longer configured in this browser: it cannot run."}</p>
                {error && <p className="field-error">{error}</p>}
                <div className="cd-actions">
                  <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                    Later
                  </button>
                  <button type="button" className="btn" onClick={() => void decide(false)} disabled={busy}>
                    Deny
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void decide(true)} disabled={busy || !account}>
                    {busy ? <Spinner /> : null}
                    Allow
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="cf-outcome">
                  <strong>{c.status === "allowed" ? "Done." : c.status === "denied" ? "Refused." : c.status === "expired" ? "Expired." : "Failed."}</strong> {c.outcome}
                </p>
                <div className="cd-actions">
                  <button type="button" className="btn btn-primary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
