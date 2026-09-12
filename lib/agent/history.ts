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
  if (m.role === "user") return [{ role: "user", content: m.content }];
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
