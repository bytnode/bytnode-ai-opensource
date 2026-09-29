"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Wizard } from "@/components/onboarding/wizard";
import { applyTheme } from "@/components/ui/theme-toggle";
import type { AgentConfig } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { updateSettings, useSettings } from "@/lib/state/settings";
import { blankAgent } from "@/lib/storage/repositories";

/* The single page: until the settings are read, nothing — the background
   is enough. Then the full wizard if the account is not configured,
   otherwise the app: the tab bar, the conversations, the plugins' views. */
/* A new agent's id and date are set at the moment it is created, not
   during render: an id drawn on every render would restart the form. */
const stamp = (a: AgentConfig): AgentConfig =>
  a.id ? a : { ...a, id: newId(), createdAt: Date.now() };

export default function Page() {
  const { ready, settings } = useSettings();

  useEffect(() => {
    if (ready) applyTheme(settings.theme);
  }, [ready, settings.theme]);

  if (!ready) return null;

  if (!settings.onboardingDone) {
    return (
      <Wizard
        steps={["profil", "auth", "agent"]}
        initial={{
          profile: settings.profile,
          authMode: settings.authMode,
          keys: settings.keys,
          theme: settings.theme,
          agent: blankAgent(),
        }}
        finishLabel="Open the chat"
        onDone={(d) => {
          const agent = stamp(d.agent);
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
        }}
      />
    );
  }

  return <AppShell settings={settings} />;
}
