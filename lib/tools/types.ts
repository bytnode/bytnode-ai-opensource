/* ---------------------------------------------------------------------------
   Ce qu'est un outil, pour l'agent comme pour l'interface.

   Un outil a un nom, une description que le modele lit, un schema JSON pour
   ses arguments, et une fonction qui l'execute dans un CONTEXTE : le dossier
   de travail de l'agent, un signal d'annulation, un emetteur d'evenements
   pour ce qui doit remonter a l'ecran pendant l'execution (les lignes d'un
   Monitor, l'avancement d'un sous-agent).

   ⚠️ TOUT CE QUI TOUCHE LE DISQUE PASSE PAR `ctx.workspace`. Les chemins
   relatifs s'y resolvent ; un chemin absolu qui en sort est refuse par
   `paths.ts`. Les shells, eux, y demarrent — c'est la sandbox.
--------------------------------------------------------------------------- */

import type { AgentEvent } from "@/lib/agent/events";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { Scope } from "./paths";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** Une image produite ou lue par un outil : envoyee au modele (dataUrl) et,
    si elle est dans le dossier de travail, affichee dans le fil (path). */
export type ToolAttachment = { type: "image"; dataUrl: string; name: string; path?: string };

export type ToolResult = {
  ok: boolean;
  /** Ce que le modele recoit. Toujours du texte ; borne par `truncate`. */
  output: string;
  /** Ce que le modele recoit EN PLUS, hors texte : une image lue. */
  attachments?: ToolAttachment[];
};

export type ToolContext = {
  /** Le dossier de travail de l'agent, absolu, existant. */
  workspace: string;
  /** Ce que les outils fichiers acceptent hors de ce dossier : rien
      (`workspace`) ou tout (`disk`). */
  scope: Scope;
  /** La racine du projet (skills partages). */
  projectRoot: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  /** Profondeur d'imbrication : 0 pour l'agent principal, 1 pour un
      sous-agent. Un sous-agent ne lance pas de sous-agents. */
  depth: number;
  /** Ce qu'il faut pour qu'un outil relance un modele (Workflow). */
  llm: { apiKey: string; model: string; effort: string | null };
  /** L'id de l'appel en cours, pour rattacher les evenements emis. */
  callId: string;
  /** Les competences propres a la profession de l'agent, deja lues. */
  professionSkills?: Array<{ name: string; description: string; path: string }>;
  /** La cle BytNode, pour qu'un sous-agent retrouve les memes outils. */
  bytnodeKey?: string;
  /** Les comptes d'exchange que l'agent peut piloter (deja filtres). */
  exchangeAccounts?: ExchangeAccount[];
};

export interface Tool<A = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

/** Ce que le modele recoit ne doit pas exploser le contexte : chaque sortie
    est coupee au-dela d'une taille raisonnable, en le disant. */
export const OUTPUT_LIMIT = 40_000;

export function truncate(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[… sortie tronquée : ${text.length - limit} caractères de plus]`;
}

export const ok = (output: string, attachments?: ToolAttachment[]): ToolResult => ({
  ok: true,
  output: truncate(output),
  ...(attachments?.length ? { attachments } : {}),
});

export const fail = (message: string): ToolResult => ({ ok: false, output: truncate(message) });

/** Une erreur en texte, quelle que soit sa forme. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
