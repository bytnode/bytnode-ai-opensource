"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { SignInScreen } from "@/components/account/sign-in-screen";
import { Wizard } from "@/components/onboarding/wizard";
import { applyTheme } from "@/components/ui/theme-toggle";
import { newId } from "@/lib/domain/conversation";
import { updateSettings, useSettings } from "@/lib/state/settings";
import { blankAgent } from "@/lib/storage/repositories";
import { useAcpAuth } from "@/lib/acp/use-auth";
import { saveConversation } from "@/lib/state/conversations";
import { setActiveConversation } from "@/lib/state/navigation";
import { firstAgent, firstAgentProvider, welcomeConversation } from "@/lib/onboarding/first-run";
import { accountKeyNote, useAccount } from "@/lib/account/account";
import { useLanguage } from "@/lib/i18n/react";

/* The single page: until the settings are read, nothing — the background
   is enough. Signed out of the BytNode account: the sign-in page and
   nothing else (user request, 2026-10-09; in a browser too since
   2026-10-12). Then the full wizard if the app is not
   configured, otherwise the app: the tab bar, the conversations, the
   plugins' views. */

export default function Page() {
  const { ready, settings } = useSettings();
  const account = useAccount();
  const acp = useAcpAuth();
  /* The chosen language, loaded before anything is shown (the sign-in
     page included): no flash of English. */
  const words = useLanguage(settings.language);

  useEffect(() => {
    if (ready) applyTheme(settings.theme);
  }, [ready, settings.theme]);

  if (!ready || !words || account === undefined) return null;

  if (account && !account.signedIn) return <SignInScreen state={account} />;

  if (!settings.onboardingDone) {
    return (
      <Wizard
        /* You (name, a few words, the look), your AI, Telegram, then your
           exchanges — the last two can be skipped (2026-10-09). The BytNode
           account already filled the name and e-mail. */
        steps={["you", "ai", "channels", "exchanges"]}
        initial={{
          profile: settings.profile,
          authMode: settings.authMode,
          keys: settings.keys,
          theme: settings.theme,
          agent: blankAgent(),
        }}
        accountKey={accountKeyNote()}
        onDone={(d) => {
          /* No agent to fill in (2026-10-09): the app makes the first one,
             on what was just connected, and opens on its welcome. */
          const now = Date.now();
          const signedIn = acp.agents.filter((a) => a.loggedIn).map((a) => a.agent);
          const agent = { ...firstAgent(firstAgentProvider(signedIn, d.keys.openrouter)), id: newId(), createdAt: now };
          const welcome = welcomeConversation(agent, d.profile, newId(), now);
          updateSettings((s) => ({
            ...s,
            onboardingDone: true,
            profile: d.profile,
            authMode: d.authMode,
            keys: d.keys,
            theme: d.theme,
            agents: [...s.agents, agent],
            activeAgentId: agent.id,
          }));
          saveConversation(welcome);
          setActiveConversation(welcome.id);
        }}
      />
    );
  }

  return <AppShell settings={settings} />;
}
