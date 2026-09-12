/* ---------------------------------------------------------------------------
   Les evenements d'un tour d'agent, du serveur vers l'ecran.

   Le serveur fait tourner la boucle (modele → outils → modele) et raconte ce
   qui se passe, un evenement JSON par ligne. Le navigateur les rejoue dans
   le message de l'assistant : le texte au fil de l'eau, chaque appel d'outil
   avec son resultat, les sous-agents. Le meme type sert des deux cotes.
--------------------------------------------------------------------------- */

/** Une image a montrer dans le fil : un chemin relatif au dossier de travail
    (servi par /api/files), ou une URL de donnees. */
export type ToolImage = { name: string; src: string };

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; output: string; images?: ToolImage[] }
  /** Une ligne produite pendant qu'un outil tourne (Monitor). */
  | { type: "tool_line"; id: string; line: string }
  | { type: "subagent"; id: string; index: number; title: string; status: "running" | "done" | "failed" }
  | { type: "error"; message: string }
  | { type: "done"; finishReason: string };

/** Un pas d'une reponse d'assistant, tel qu'il est memorise et affiche. */
export type Step =
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** `pending` : l'accord de l'utilisateur est attendu. `denied` : refuse. */
      status: "pending" | "running" | "done" | "failed" | "denied";
      output?: string;
      lines?: string[];
      images?: ToolImage[];
    };
