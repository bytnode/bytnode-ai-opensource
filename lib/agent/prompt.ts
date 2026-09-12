import type { AgentConfig, Profile } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Le prompt systeme : l'identite de l'agent, puis ce que l'utilisateur lui a
   confie. Chaque section n'apparait que si elle a quelque chose a dire — un
   titre « Contexte » suivi de rien apprend au modele qu'il n'y a pas de
   contexte, ce qui n'est pas la meme chose que ne rien dire.

   ⚠️ C'EST ICI QUE LES OUTILS S'ANNONCERONT PLUS TARD. La fonction prend la
   configuration entiere pour que l'ajout d'une section ne change pas sa
   signature.
--------------------------------------------------------------------------- */

const fullName = (p: Profile) => [p.firstName, p.lastName].map((s) => s.trim()).filter(Boolean).join(" ");

export function buildSystemPrompt(profile: Profile, agent: AgentConfig): string {
  const name = agent.name.trim() || "Assistant";
  const user = fullName(profile);
  const parts: string[] = [];

  parts.push(
    `Tu es ${name}, un assistant conversationnel.` +
      (user ? ` Tu parles avec ${user}.` : "") +
      " Réponds dans la langue de ton interlocuteur, avec précision et sans remplissage.",
  );

  const bio = profile.bio.trim();
  if (bio) parts.push(`## À propos de ${user || "l'utilisateur"}\n\n${bio}`);

  const context = agent.contextText.trim();
  if (context) parts.push(`## Contexte fourni par l'utilisateur\n\n${context}`);

  if (agent.contextFiles.length > 0) {
    const files = agent.contextFiles
      .map((f) => `### Fichier : ${f.name}\n\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");
    parts.push(`## Fichiers de référence\n\n${files}`);
  }

  return parts.join("\n\n");
}
