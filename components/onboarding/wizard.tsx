"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentConfig, ApiKeys, AuthMode, Profile, Theme } from "@/lib/domain/types";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { accountBridge, type AccountKeyNote } from "@/lib/account/account";
import { useTypewriter } from "@/lib/ui/typewriter";
import { Field } from "@/components/ui/field";
import { applyTheme } from "@/components/ui/theme-toggle";
import { LanguageSelect } from "@/components/ui/language-select";
import { useSettings } from "@/lib/state/settings";
import { useMessages } from "@/lib/i18n/react";
import type { Messages } from "@/lib/i18n/messages/en";
import { CompanionFigure } from "@/components/account/companion-figure";
import { BytnodeKey, OpenRouterKey, Subscriptions } from "./step-auth";
import { ExchangeAccounts } from "./exchange-accounts";
import { TelegramBots } from "./telegram-bots";
import "./onboarding.css";
import "./first-run.css";

/* ---------------------------------------------------------------------------
   The first launch's setup: a GUIDED page you scroll through (user
   requests, 2026-10-09: « le petit avatar à côté parlerait dans une bulle »,
   « l'avatar et la conversation font partie de ce bloc », « pas cliquer sur
   continuer mais plutôt scroller vers le bas avec des transitions fluides,
   la barre d'évolution sur le côté »).

   One screen per step, one under the other; the page snaps from one to the
   next. On each screen the companion — on the left, then the right, in
   turn — says in a speech bubble what the step is for and the one thing
   worth knowing, written as it speaks, the first time the screen is
   reached, once the app's window is in front; beside it, the step, on the
   page itself (no frame).
   The blocks rise in and settle as they scroll into view (scroll-driven,
   no timer). A rail on the side follows the scroll continuously.

   A step that is not complete is the last one shown: the next screens
   appear when it is (a first name; a subscription or an OpenRouter key).
   Four steps — you (name, a few words, the look, applied as you pick),
   your AI, Telegram (optional, « Skip » beside « Add »), your exchanges
   (optional, « Skip and start » beside « Add », « Start » once an account
   is added). No arrows: the page scrolls, and the rail takes you to a step. The npm app also asks the BytNode
   key with the AI. The draft is only handed over at the end.
--------------------------------------------------------------------------- */

export type StepId = "you" | "ai" | "exchanges" | "channels";

export type WizardDraft = {
  profile: Profile;
  authMode: AuthMode;
  keys: ApiKeys;
  theme: Theme;
  agent: AgentConfig;
};

type Props = {
  steps: StepId[];
  initial: WizardDraft;
  onDone: (draft: WizardDraft) => void;
  /** The desktop app's first setup: the BytNode key made at sign-in, or
      why none could be (`lib/account/account.ts`). */
  accountKey?: AccountKeyNote;
};

type Source = "subscription" | "key";

export function Wizard({ steps, initial, onDone, accountKey = null }: Props) {
  const m = useMessages();
  const t = m.onboarding.wizard;
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [source, setSource] = useState<Source>(initial.keys.openrouter.trim() ? "key" : "subscription");
  const auth = useAcpAuth();
  /* The language is saved as soon as it is picked, not with the draft: the
     whole setup changes language under the user's eyes. */
  const language = useSettings().settings.language;
  const subscribed = auth.agents.some((a) => a.loggedIn);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Array<HTMLElement | null>>([]);
  /* The screen in view, and the screens reached at least once (their
     companion has spoken). */
  const [active, setActive] = useState(0);
  const [reached, setReached] = useState<number[]>([0]);

  /* The BytNode key is not asked in the desktop app (made at sign-in);
     only when that failed, and always in the npm app. */
  const desktop = accountBridge() !== null;
  const askBytnode = !desktop || accountKey?.kind === "failed" || !draft.keys.bytnode.trim();
  const keys = draft.keys;
  const setKeys = (k: ApiKeys) => setDraft({ ...draft, keys: k });
  const setProfile = (patch: Partial<Profile>) => setDraft({ ...draft, profile: { ...draft.profile, ...patch } });
  const setTheme = (theme: Theme) => {
    applyTheme(theme);
    setDraft({ ...draft, theme });
  };

  /* Shown: every step up to the first incomplete one, included. */
  const firstOpen = steps.findIndex((s) => Object.keys(validate(s, draft, subscribed, m)).length > 0);
  const shownSteps = firstOpen < 0 ? steps : steps.slice(0, firstOpen + 1);
  const complete = firstOpen < 0;

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let i = 0;
    sections.current.forEach((s, k) => {
      if (s && s.offsetTop <= mid) i = k;
    });
    if (i !== active) setActive(i);
    if (!reached.includes(i)) setReached([...reached, i]);
  };
  const goTo = (i: number) => sections.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  /* Into the app: once every required step is complete. */
  const finish = () => {
    if (complete) onDone({ ...draft, authMode: source === "key" ? "keys" : "subscription" });
  };

  return (
    <div className="fr" role="dialog" aria-modal="true" aria-label={t.dialog} ref={scroller} onScroll={onScroll}>
      <header className="fr-top">
        <span className="fr-brand">BytNode-AI</span>
      </header>

      <nav className="fr-rail" aria-label={t.stepsNav}>
        <span className="fr-rail-track" aria-hidden="true">
          <span className="fr-rail-fill" />
        </span>
        <ol>
          {steps.map((s, i) => {
            const open = i < shownSteps.length;
            return (
              <li key={s} className={`${i === active ? "is-current" : i < active ? "is-done" : ""}${open ? "" : " is-locked"}`} style={{ top: `${(i / Math.max(1, steps.length - 1)) * 100}%` }}>
                <button type="button" disabled={!open} onClick={() => goTo(i)} aria-current={i === active ? "step" : undefined}>
                  {t.steps[s]}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {shownSteps.map((step, i) => {
        const errors = validate(step, draft, subscribed, m);
        const isLast = i === steps.length - 1;
        return (
          <section
            key={step}
            className="fr-section"
            ref={(el) => {
              sections.current[i] = el;
            }}
            aria-labelledby={`fr-title-${step}`}
          >
            <div className="fr-card">
              <aside className="fr-guide">
                <Speech line={say(step, draft.profile.firstName.trim(), desktop, m)} play={reached.includes(i)} ready={Object.keys(errors).length === 0} />
              </aside>

              <div className="fr-step">
                {step === "you" && (
                  <>
                    <h1 id="fr-title-you" className="fr-title">
                      {t.youTitle}
                    </h1>
                    <div className="fr-form">
                      <div className="field">
                        <span className="field-label">{m.language.label}</span>
                        <LanguageSelect id="language" value={language} />
                      </div>
                      <Field id="firstName" label={t.firstName} error={errors.firstName}>
                        <input id="firstName" className="field-input" autoComplete="given-name" value={draft.profile.firstName} onChange={(e) => setProfile({ firstName: e.target.value })} />
                      </Field>
                      <Field id="bio" label={t.bio} optional hint={t.bioHint}>
                        <textarea id="bio" className="field-input fr-bio" placeholder={t.bioPlaceholder} value={draft.profile.bio} onChange={(e) => setProfile({ bio: e.target.value })} />
                      </Field>
                      <div className="field">
                        <span className="field-label">{t.appearance}</span>
                        <div className="fr-themes" role="radiogroup" aria-label={t.appearance}>
                          {(["dark", "light"] as Theme[]).map((th) => (
                            <button key={th} type="button" role="radio" aria-checked={draft.theme === th} className={`fr-theme fr-theme-${th}${draft.theme === th ? " is-on" : ""}`} onClick={() => setTheme(th)}>
                              <span className="fr-theme-swatch" aria-hidden="true" />
                              {th === "dark" ? t.dark : t.light}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="ob-row">
                        <Field id="lastName" label={t.lastName} optional>
                          <input id="lastName" className="field-input" autoComplete="family-name" value={draft.profile.lastName} onChange={(e) => setProfile({ lastName: e.target.value })} />
                        </Field>
                        <Field id="email" label={t.email} optional>
                          <input id="email" className="field-input" type="email" autoComplete="email" value={draft.profile.email} onChange={(e) => setProfile({ email: e.target.value })} />
                        </Field>
                      </div>
                    </div>
                  </>
                )}

                {step === "ai" && (
                  <>
                    <h1 id="fr-title-ai" className="fr-title">
                      {t.aiTitle}
                    </h1>
                    <div className="fr-choices" role="radiogroup" aria-label={t.aiChoices}>
                      <button type="button" role="radio" aria-checked={source === "subscription"} className={`fr-choice${source === "subscription" ? " is-on" : ""}`} onClick={() => setSource("subscription")}>
                        <span className="fr-choice-title">{t.subscriptionTitle}</span>
                        <span className="fr-choice-desc">{t.subscriptionDesc}</span>
                      </button>
                      <button type="button" role="radio" aria-checked={source === "key"} className={`fr-choice${source === "key" ? " is-on" : ""}`} onClick={() => setSource("key")}>
                        <span className="fr-choice-title">{t.keyTitle}</span>
                        <span className="fr-choice-desc">{t.keyDesc}</span>
                      </button>
                    </div>

                    <SmoothHeight>
                      <div className="fr-panel" key={source}>
                        {source === "subscription" ? <Subscriptions /> : <OpenRouterKey value={keys.openrouter} onChange={(openrouter) => setKeys({ ...keys, openrouter })} />}
                      </div>
                    </SmoothHeight>

                    {askBytnode && (
                      <div className="fr-panel fr-bytnode">
                        {accountKey?.kind === "failed" && <p className="field-hint">{accountKey.message}</p>}
                        <BytnodeKey value={keys.bytnode} onChange={(bytnode) => setKeys({ ...keys, bytnode })} />
                      </div>
                    )}
                  </>
                )}

                {step === "channels" && (
                  <>
                    <h1 id="fr-title-channels" className="fr-title">
                      {t.channelsTitle}
                    </h1>
                    <p className="fr-lede">{t.channelsLede}</p>
                    <div className="fr-panel">
                      <TelegramBots startOpen aside={{ label: m.common.skip, onClick: () => goTo(i + 1) }} value={keys.telegram} onChange={(telegram) => setKeys({ ...keys, telegram })} />
                    </div>
                  </>
                )}

                {step === "exchanges" && (
                  <>
                    <h1 id="fr-title-exchanges" className="fr-title">
                      {t.exchangesTitle}
                    </h1>
                    <p className="fr-lede">{t.exchangesLede}</p>
                    <div className="fr-panel fr-xch">
                      <ExchangeAccounts startOpen aside={{ label: t.skipAndStart, onClick: finish }} value={keys.exchanges} onChange={(exchanges) => setKeys({ ...keys, exchanges })} />
                    </div>
                  </>
                )}

              </div>

              {/* No arrow to go down (2026-10-09): the page scrolls. Under the
                  step, what it still needs; at the end, once an account is
                  added, the way into the app. */}
              {(Object.keys(errors).length > 0 || (isLast && keys.exchanges.length > 0)) && (
                <footer className="fr-foot">
                  {Object.keys(errors).length > 0 ? (
                    <p className="fr-wait">{Object.values(errors)[0]}</p>
                  ) : (
                    <button type="button" className="btn btn-primary fr-next" onClick={finish}>
                      {m.common.start}
                    </button>
                  )}
                </footer>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A box whose height follows its content smoothly: switching between the
    subscriptions and the OpenRouter key glides instead of jumping
    (2026-10-09: « un peu trop d'un coup »). */
function SmoothHeight({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      o.style.height = `${i.offsetHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="fr-smooth">
      <div ref={inner}>{children}</div>
    </div>
  );
}

/** The companion and its bubble. The words write themselves, as if it
    were speaking — the first time its screen is reached (`play`), and once
    the app's window is in front: not while the user is still in the
    browser signing in. Before that the bubble waits, laid out at its final
    size (the words to come are there, invisible), so nothing moves around
    them. Reached again, the words are simply there. It smiles while it
    talks, and once the step is ready. */
function Speech({ line, play, ready }: { line: string; play: boolean; ready: boolean }) {
  const typed = useTypewriter(line, { enabled: play, cps: 52, delay: 520, waitForFocus: true });
  const shown = play ? typed.shown : "";
  return (
    <>
      <CompanionFigure size={176} className="fr-companion" mood={{ hover: (play && !typed.done) || ready }} />
      <p className="fr-bubble">
        <span className="fr-sr">{line}</span>
        <span aria-hidden="true">
          {shown}
          <span className="fr-ghost">{line.slice(shown.length)}</span>
        </span>
      </p>
    </>
  );
}

/** What the companion says at each step: the purpose, and the one thing
    worth knowing. Short on purpose. */
function say(step: StepId, firstName: string, desktop: boolean, m: Messages): string {
  const t = m.onboarding.wizard.say;
  if (step === "you") return t.you(firstName);
  if (step === "ai") return t.ai;
  if (step === "channels") return t.channels;
  return t.exchanges(desktop);
}

export type StepErrors = Partial<Record<"firstName" | "openrouter" | "subscription" | "bytnode" | "name" | "providerId", string>>;

function validate(step: StepId, d: WizardDraft, subscribed: boolean, m: Messages): StepErrors {
  const e: StepErrors = {};
  const t = m.onboarding.wizard.errors;
  if (step === "you" && !d.profile.firstName.trim()) e.firstName = t.firstName;
  /* At least one access to the models: a subscription or an OpenRouter
     key, either one. */
  if (step === "ai" && !d.keys.openrouter.trim() && !subscribed) e.subscription = t.subscription;
  /* The BytNode key is not optional: without market data, the agent has
     nothing to analyse. */
  if (step === "ai" && !d.keys.bytnode.trim()) e.bytnode = t.bytnode;
  return e;
}
