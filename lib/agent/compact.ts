import type { Message } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Compacter une conversation.

   Une conversation longue est renvoyee en entier a chaque tour : elle
   devient chere, lente, et finit par depasser la fenetre du modele.
   `/compact` demande a l'agent un resume de ce qui a ete fait et decide,
   puis le fil est remplace par ce resume — la conversation continue, avec
   sa memoire, sans son poids.

   Le meme mecanisme sert aux deux moteurs : un agent sur OpenRouter voit
   le resume en tete de son historique ; un agent par abonnement repart sur
   une session neuve amorcee par ce resume.

   Pur : pas de disque, pas de reseau.
--------------------------------------------------------------------------- */

/** `/compact`, seule ou suivie de consignes. Rend `null` si le texte n'est
    pas la commande — un message qui la mentionne n'est pas la commande. */
export function isCompactCommand(text: string): { instructions: string } | null {
  const m = text.trim().match(/^\/compact(?:\s+([\s\S]*))?$/i);
  return m ? { instructions: (m[1] ?? "").trim() } : null;
}

export const COMPACT_LABEL = "Conversation compactée";

/** Qui a declenche la compaction : l'utilisateur (`/compact`), la jauge
    pleine en fin de tour (`auto`), ou une erreur « contexte depasse » du
    fournisseur (`overflow`). */
export type CompactedBy = "user" | "auto" | "overflow";

export function compactLabel(m: Pick<Message, "compactedBy">): string {
  switch (m.compactedBy) {
    case "auto":
      return `${COMPACT_LABEL} automatiquement — fenêtre pleine`;
    case "overflow":
      return `${COMPACT_LABEL} automatiquement — contexte dépassé`;
    default:
      return COMPACT_LABEL;
  }
}

/* ⚠️ « CONTEXTE DEPASSE » N'EST PAS UNE ERREUR TRANSITOIRE. Relancer la meme
   requete echouerait pareil ; la seule issue est de compacter le fil puis de
   rejouer. Chaque fournisseur le dit a sa maniere (OpenRouter, Anthropic,
   OpenAI…) : on reconnait la famille de formulations, sur un 400/413 ou
   sans statut. */
const OVERFLOW_TEXT = /context.length|context.limit|too long|too many tokens|maximum.*tokens|tokens.*maximum|exceed.*context/i;

export function isContextOverflow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; status?: unknown; message?: unknown };
  if (e.name === "AbortError") return false;
  if (typeof e.status === "number" && e.status !== 400 && e.status !== 413) return false;
  return typeof e.message === "string" && OVERFLOW_TEXT.test(e.message);
}

/** Ce qu'on demande a l'agent. Il connait le fil : inutile de le lui
    redonner, il suffit de lui dire quoi en garder. */
export function buildCompactRequest(instructions: string): string {
  const lines = [
    "Fais le résumé de notre conversation jusqu'ici. Ce résumé va REMPLACER le fil : tout ce qui n'y figure pas sera perdu pour la suite.",
    "",
    "Structure-le ainsi, en gardant les chiffres et les chemins de fichiers exacts :",
    "1. **Demande** — ce que l'utilisateur cherche à obtenir, dans ses termes.",
    "2. **Fait** — ce qui a été mesuré, calculé, écrit ou testé, avec les valeurs et les fichiers produits (chemins complets).",
    "3. **Décisions** — ce qui a été tranché, et pourquoi ; les préférences exprimées par l'utilisateur.",
    "4. **En cours** — ce qui n'est pas terminé, et l'étape suivante immédiate.",
    "5. **À ne pas refaire** — les pistes essayées sans succès, pour ne pas y revenir.",
    "",
    "Sois dense et factuel : pas de formules de politesse, pas de commentaire sur le résumé lui-même. Ne résume pas ce résumé : écris-le.",
  ];
  if (instructions) lines.push("", `Consigne de l'utilisateur pour ce résumé : ${instructions}`);
  return lines.join("\n");
}

const MAX_TRANSCRIPT = 12_000;

/** Le fil en texte, pour un agent qui ne l'a plus (session perdue, ou
    nouvelle session apres compactage). Borne : les derniers echanges. */
export function transcriptOf(messages: Message[], max = MAX_TRANSCRIPT): string {
  const lines = messages
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Agent"} : ${m.content.trim()}`);
  const out = lines.join("\n\n");
  return out.length > max ? `[…]\n${out.slice(-max)}` : out;
}

/** Le message qui remplace le fil. Il porte `compaction` : le fil l'affiche
    comme un resume, et `history.ts` le rejoue comme un rappel de contexte. */
export function compactionMessage(summary: string, id: string, createdAt: number, compactedBy: CompactedBy = "user"): Message {
  return { id, role: "assistant", content: summary, createdAt, compaction: true, compactedBy, steps: [{ type: "text", text: summary }] };
}

/** Faut-il proposer le compactage ? (assez de matiere pour que ça serve) */
export const worthCompacting = (messages: Message[]) =>
  messages.filter((m) => m.content.trim()).length >= 4 && messages.reduce((n, m) => n + m.content.length, 0) > 4_000;
