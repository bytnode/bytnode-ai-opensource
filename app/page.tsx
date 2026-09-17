"use client";

import { useEffect } from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import { Wizard } from "@/components/onboarding/wizard";
import { applyTheme } from "@/components/ui/theme-toggle";
import type { AgentConfig } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { updateSettings, useSettings } from "@/lib/state/settings";
import { blankAgent } from "@/lib/storage/repositories";

/* La page unique : tant que les reglages ne sont pas lus, rien — le fond
   suffit. Puis l'assistant complet si le compte n'est pas configure, sinon
   le chat. */
/* L'id et la date d'un agent nouveau sont poses au moment ou il est cree, pas
   pendant le rendu : un id tire a chaque rendu ferait redemarrer la feuille. */
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
        finishLabel="Ouvrir le chat"
        onTheme={(theme) => updateSettings((s) => ({ ...s, theme }))}
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

  return <ChatShell settings={settings} />;
}
