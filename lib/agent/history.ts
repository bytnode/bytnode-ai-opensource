import type { Message } from "@/lib/domain/types";
import type { Step } from "./events";

/* ---------------------------------------------------------------------------
   Rejouer une conversation au format du fournisseur.

   Un message d'assistant memorise ses PAS : du texte, des appels d'outils
   avec leur resultat. Le fournisseur, lui, veut une suite de messages —
   `assistant` avec ses `tool_calls`, puis un message `tool` par resultat,
   puis `assistant` a nouveau si le texte a repris. On reconstruit cette
   suite a chaque tour ; c'est ce qui permet au modele de se souvenir de ce
   qu'il a lu et fait.
--------------------------------------------------------------------------- */

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export function stepsToMessages(m: Message): ProviderMessage[] {
  if (m.role === "user") {
    /* Les images jointes accompagnent le texte : le modele doit les voir
       pour en parler. Les autres fichiers sont sur le disque, et le texte
       en donne les chemins. */
    const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
    if (images.length === 0) return [{ role: "user", content: m.content }];
    return [
      {
        role: "user",
        content: [
          { type: "text", text: m.content },
          ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.dataUrl as string } })),
        ],
      },
    ];
  }
  /* Le resume d'un fil compacte n'est pas une reponse de l'agent : c'est du
     contexte. Il est rejoue comme tel, pour que le modele s'appuie dessus
     au lieu de croire qu'il vient de le dire. */
  if (m.compaction) {
    return [
      {
        role: "user",
        content: `<resume_du_fil_precedent>\n${m.content}\n</resume_du_fil_precedent>\n\nLa conversation a été compactée : ce résumé remplace tout ce qui précède. Reprends à partir de là.`,
      },
    ];
  }
  const steps = m.steps;
  if (!steps || steps.length === 0) return [{ role: "assistant", content: m.content }];

  const out: ProviderMessage[] = [];
  let text = "";
  let pendingCalls: Extract<Step, { type: "tool" }>[] = [];

  const flushText = () => {
    if (text && pendingCalls.length === 0) out.push({ role: "assistant", content: text });
  };
  const flushCalls = () => {
    if (pendingCalls.length === 0) return;
    out.push({
      role: "assistant",
      content: text || null,
      tool_calls: pendingCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    });
    for (const c of pendingCalls) {
      out.push({
        role: "tool",
        tool_call_id: c.id,
        content: c.status === "running" || c.status === "pending" ? "[outil interrompu avant d'avoir répondu]" : (c.output ?? ""),
      });
    }
    pendingCalls = [];
    text = "";
  };

  for (const s of steps) {
    /* Ni le plan ni le raisonnement ne repartent au modele : ils sont la
       pour l'utilisateur, et les rejouer brouillerait le contexte. */
    if (s.type === "plan" || s.type === "thought") continue;
    if (s.type === "text") {
      if (pendingCalls.length > 0) flushCalls();
      text += s.text;
    } else {
      pendingCalls.push(s);
    }
  }
  if (pendingCalls.length > 0) flushCalls();
  else flushText();
  return out;
}

/* ---------------------------------------------------------------------------
   Elaguer les vieux resultats d'outils.

   ⚠️ CE SONT LES SORTIES D'OUTILS QUI REMPLISSENT LA FENETRE. Un `Read` de
   CSV, un `Bash` verbeux : 40 000 caracteres chacun, rejoues a chaque tour
   jusqu'a la fin du fil. Comme Claude Code ou Codex, quand le fil pese, les
   `keep` derniers resultats restent entiers — c'est le plan de travail du
   moment — et les plus anciens sont reduits a leur debut plus un marqueur
   qui dit au modele de relancer l'outil s'il lui manque le detail.

   Ne touche que le rejeu : le fil affiche garde tout. Pur.
--------------------------------------------------------------------------- */

export type PruneOptions = {
  /** Combien de resultats d'outils, les plus recents, rester entiers. */
  keep: number;
  /** Combien de caracteres garder en tete d'un resultat elague. */
  head: number;
};

export function pruneToolOutputs(messages: ProviderMessage[], opts: PruneOptions): ProviderMessage[] {
  const tools = messages.filter((m) => m.role === "tool").length;
  const cutoff = tools - opts.keep;
  if (cutoff <= 0) return messages;
  let seen = 0;
  return messages.map((m) => {
    if (m.role !== "tool") return m;
    const old = seen++ < cutoff;
    if (!old || m.content.length <= opts.head) return m;
    const more = m.content.length - opts.head;
    return {
      ...m,
      content: `${m.content.slice(0, opts.head)}
[… sortie élaguée pour libérer du contexte (${more} caractères de plus). Relance l'outil si tu as besoin du détail.]`,
    };
  });
}
