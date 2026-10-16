"use client";

import { useRef, useState } from "react";
import { accountBridge, accountErrorText, refreshAccount, setUpAccount, profileFromAccount, type AccountState } from "@/lib/account/account";
import { useMessages } from "@/lib/i18n/react";
import { currentSettings, updateSettings } from "@/lib/state/settings";
import { CompanionFigure } from "./companion-figure";
import "@/components/onboarding/onboarding.css";
import "./sign-in.css";

/* ---------------------------------------------------------------------------
   The app's first page (user request, 2026-10-09; in a browser too since
   2026-10-12): sign in with the BytNode account, through the browser — in
   the desktop app the system's browser, in a browser a new tab.

   « Sign in with the browser » opens bytnode.com/auth/desktop: already
   signed in there, one click (« Open BytNode-AI ») and the browser hands
   the app its session; otherwise the usual sign-in (Google, e-mail…) first.
   Back here, before the app opens, its setup: a BytNode key made for it
   when there is none, the profile filled from the account. Then the
   onboarding — or, for someone who already had it done, the app itself.

   The page is the app's companion saying hello (« plus chaleureux », the
   app's own look): it floats over the sheet, follows the pointer, smiles
   when the button is under it, and works — blue eyes, a sweep — while the
   browser does its part. The rest stays as plain as before.
--------------------------------------------------------------------------- */

type Phase = { kind: "idle" } | { kind: "waiting" } | { kind: "setting-up" } | { kind: "failed"; message: string };

export function SignInScreen({ state }: { state: Extract<AccountState, { signedIn: false }> }) {
  const m = useMessages();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hover, setHover] = useState(false);
  /* « Open the page again » starts a new sign-in and cancels the one
     before: that one's answer (cancelled) must not reset the page. */
  const attempt = useRef(0);

  const signIn = async () => {
    const bridge = accountBridge();
    if (!bridge) return;
    const mine = ++attempt.current;
    setPhase({ kind: "waiting" });
    const r = await bridge.signIn();
    if (mine !== attempt.current) return;
    if (!r.ok) {
      setPhase(r.cancelled ? { kind: "idle" } : { kind: "failed", message: r.message });
      return;
    }
    setPhase({ kind: "setting-up" });
    const settings = currentSettings();
    const key = await setUpAccount(!!settings.keys.bytnode.trim());
    updateSettings((s) => ({
      ...s,
      profile: profileFromAccount(s.profile, r.account),
      keys: key ? { ...s.keys, bytnode: key } : s.keys,
    }));
    /* Only now does the page leave for the app: the key and the profile
       are in the settings the onboarding starts from. */
    refreshAccount();
  };

  const cancel = () => void accountBridge()?.cancel();
  const working = phase.kind === "waiting" || phase.kind === "setting-up";
  /* Worded at render (`accountErrorText`): a change of language rewords it. */
  const error = phase.kind === "failed" ? accountErrorText(phase.message) : state.reason ? m.account.signedOut(accountErrorText(state.reason)) : null;

  return (
    <div className="ob si" role="dialog" aria-modal="true" aria-labelledby="si-title">
      <div className="si-card">
        <CompanionFigure size={188} className="si-companion" mood={{ hover: hover && !working, busy: working }} />
        <h1 id="si-title" className="si-title">
          {m.account.welcome}
        </h1>
        <p className="si-lede">{m.account.lede}</p>

        {phase.kind === "waiting" ? (
          <div className="si-wait" aria-live="polite">
            <p className="si-status">{m.account.finishInBrowser}</p>
            <div className="si-actions">
              <button type="button" className="btn btn-ghost" onClick={signIn}>
                {m.account.openAgain}
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                {m.common.cancel}
              </button>
            </div>
          </div>
        ) : phase.kind === "setting-up" ? (
          <p className="si-status" aria-live="polite">
            {m.account.settingUp}
          </p>
        ) : (
          <>
            {error && (
              <p className="field-error si-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="btn btn-primary si-go" onClick={signIn} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
              {m.account.signIn}
            </button>
            <p className="si-note">{m.account.note}</p>
          </>
        )}
      </div>
    </div>
  );
}
