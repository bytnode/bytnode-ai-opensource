import type {
  PermissionOption,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionUpdate,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type { Model } from "@/lib/domain/types";
import { ACP_PREFIX, type AcpAgentId } from "./agents";
import type { PlanEntry, UsageInfo } from "@/lib/agent/events";
import type { WireEvent } from "./wire";

/* ---------------------------------------------------------------------------
   Traduire ce qu'un agent ACP raconte dans le vocabulaire de BytNode-AI.

   L'agent externe envoie des `session/update` : morceaux de texte, appels
   d'outils avec leur etat, plans, changements de mode. Le fil de BytNode-AI
   ne connait que des `AgentEvent` (texte, appel, resultat) : on ne garde que
   ce qui s'y projette. Rien ici ne touche au reseau ni au processus —
   c'est ce qui rend ces regles testables.
--------------------------------------------------------------------------- */

const KIND_LABELS: Record<ToolKind, string> = {
  read: "Lecture",
  edit: "Modification",
  delete: "Suppression",
  move: "Déplacement",
  search: "Recherche",
  execute: "Commande",
  think: "Réflexion",
  fetch: "Web",
  switch_mode: "Mode",
  other: "Outil",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Le nom de l'outil : celui que l'agent declare, sinon celui que Claude
    Code glisse dans les metadonnees, sinon la categorie. */
function toolName(update: Pick<ToolCallUpdate, "name" | "kind" | "_meta">): string | null {
  const meta = update._meta?.claudeCode;
  const fromMeta = isRecord(meta) && typeof meta.toolName === "string" ? meta.toolName : null;
  return update.name?.trim() || fromMeta || (update.kind ? KIND_LABELS[update.kind] : null);
}

const argsOf = (update: Pick<ToolCallUpdate, "rawInput" | "title">): Record<string, unknown> | null => {
  if (isRecord(update.rawInput) && Object.keys(update.rawInput).length > 0) return update.rawInput;
  return update.title ? { title: update.title } : null;
};

export function eventsOfUpdate(update: SessionUpdate): WireEvent[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text" ? [{ type: "text", text: update.content.text }] : [];
    case "agent_thought_chunk":
      return update.content.type === "text" ? [{ type: "thought", text: update.content.text }] : [];
    case "plan":
    case "plan_update": {
      const entries = (update as { entries?: Array<{ content?: string; status?: string }> }).entries ?? [];
      const plan: PlanEntry[] = entries
        .filter((e) => typeof e.content === "string" && e.content.trim())
        .map((e) => ({
          content: e.content as string,
          status: e.status === "completed" ? "completed" : e.status === "in_progress" ? "in_progress" : "pending",
        }));
      return plan.length ? [{ type: "plan", entries: plan }] : [];
    }
    case "usage_update": {
      const u = update as { used?: number; size?: number; cost?: { amount?: number } };
      const usage: UsageInfo = {};
      if (typeof u.used === "number") usage.context = u.used;
      if (typeof u.size === "number") usage.window = u.size;
      if (typeof u.cost?.amount === "number") usage.cost = u.cost.amount;
      return Object.keys(usage).length ? [{ type: "usage", usage }] : [];
    }
    case "tool_call": {
      const name = toolName(update) ?? KIND_LABELS.other;
      const events: WireEvent[] = [{ type: "tool_call", id: update.toolCallId, name, args: argsOf(update) ?? {} }];
      /* Un appel deja termine a sa naissance (rejoue par `session/load`). */
      if (update.status === "completed" || update.status === "failed") {
        events.push({ type: "tool_result", id: update.toolCallId, ok: update.status === "completed", output: toolOutputOf(update) });
      }
      return events;
    }
    case "tool_call_update": {
      if (update.status === "completed" || update.status === "failed") {
        const images = imagesOf(update);
        return [{ type: "tool_result", id: update.toolCallId, ok: update.status === "completed", output: toolOutputOf(update), ...(images.length ? { images } : {}) }];
      }
      /* En cours : l'agent precise le nom, les arguments, parfois une sortie
         partielle (Claude Code envoie les arguments dans un second temps). */
      const name = toolName(update);
      const args = argsOf(update);
      const partial = (update.content ?? []).map(contentText).filter(Boolean).join("\n");
      if (!name && !args && !partial) return [];
      return [{ type: "tool_update", id: update.toolCallId, ...(name ? { name } : {}), ...(args ? { args } : {}), ...(partial ? { line: partial } : {}) }];
    }
    default:
      return [];
  }
}

/** Les images d'un resultat (un graphique rendu par nos outils MCP), en
    URL de donnees pour le fil — bornees, le fil vit dans localStorage. */
const MAX_IMAGE_DATA = 400_000;
export function imagesOf(update: Pick<ToolCallUpdate, "content" | "rawOutput">): Array<{ name: string; src: string }> {
  const out: Array<{ name: string; src: string }> = [];
  const push = (mime: string, data: string) => {
    if (data.length <= MAX_IMAGE_DATA) out.push({ name: `image ${out.length + 1}`, src: `data:${mime};base64,${data}` });
  };
  for (const c of update.content ?? []) {
    if (c.type === "content" && c.content.type === "image") push(c.content.mimeType, c.content.data);
  }
  if (out.length === 0 && Array.isArray(update.rawOutput)) {
    for (const b of update.rawOutput as Array<{ type?: string; data?: string; mimeType?: string }>) {
      if (b?.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string") push(b.mimeType, b.data);
    }
  }
  return out;
}

/** Ce qu'on montre comme sortie d'un appel : ses contenus texte, un diff
    resume par son chemin et son nouveau texte, sinon la sortie brute. */
export function toolOutputOf(update: Pick<ToolCallUpdate, "toolCallId" | "content" | "rawOutput" | "status">): string {
  /* Un echec : l'erreur brute d'abord, le diff qui n'a pas ete applique
     n'apprend rien. */
  if (update.status === "failed" && typeof update.rawOutput === "string" && update.rawOutput.trim()) return update.rawOutput;
  const parts: string[] = [];
  for (const c of update.content ?? []) parts.push(contentText(c));
  const text = parts.filter(Boolean).join("\n").trim();
  if (text) return text;
  const raw = update.rawOutput;
  if (raw === undefined || raw === null) return "";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

function contentText(c: ToolCallContent): string {
  switch (c.type) {
    case "content":
      return c.content.type === "text" ? c.content.text : `[${c.content.type}]`;
    case "diff":
      return `${c.path}\n${c.newText}`;
    case "terminal":
      return `[terminal ${c.terminalId}]`;
    default:
      return "";
  }
}

/* --- Modeles et efforts, depuis les options de session ------------------ */

const flatOptions = (opts: SessionConfigOption & { type: "select" }): SessionConfigSelectOption[] =>
  opts.options.flatMap((o) => ("group" in o ? o.options : [o]));

const selectOf = (options: SessionConfigOption[], category: string) =>
  options.find((o): o is SessionConfigOption & { type: "select" } => o.type === "select" && o.category === category) ?? null;

/** L'id de modele d'un agent qui n'en publie aucun : on le laisse a son
    reglage, et on n'essaie pas de le changer. */
export const DEFAULT_MODEL = "default";

/** Ce qu'une session dit de ses modeles, sous ses deux formes : les options
    de configuration (categorie `model`, la forme actuelle) ou l'ancien
    champ `models` (Gemini CLI). */
export type SessionModels = {
  configOptions?: SessionConfigOption[] | null;
  models?: { availableModels: { modelId: string; name: string; description?: string | null }[]; currentModelId: string } | null;
  modes?: { availableModes: { id: string; name: string; description?: string | null }[]; currentModeId: string } | null;
};

/** Les modes d'une session : la facon dont l'agent externe se comporte
    (« Défaut », « Plan », « Accepter les modifications »…). Deux formes :
    une option de configuration de categorie `mode` (Claude Code, Copilot)
    ou l'ancien champ `modes` (Gemini CLI). `configId` dit par quelle voie
    le changer. */
export type AgentModes = { configId: string | null; current: string; options: Array<{ value: string; name: string; description?: string | null }> };

export function modesOfSession(session: SessionModels): AgentModes | null {
  const select = selectOf(session.configOptions ?? [], "mode");
  if (select) {
    return { configId: select.id, current: select.currentValue, options: flatOptions(select).map((o) => ({ value: o.value, name: o.name, description: o.description ?? null })) };
  }
  if (session.modes) {
    return {
      configId: null,
      current: session.modes.currentModeId,
      options: session.modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description ?? null })),
    };
  }
  return null;
}

/** Les modeles que l'agent propose, dans son ordre (le premier compte comme
    le plus recent : c'est celui que l'agent met en avant). Sans aucun
    modele publie, un seul : « par defaut ». */
export function modelsOfSession(agent: AcpAgentId, session: SessionModels, staticEfforts: string[]): Model[] {
  const options = session.configOptions ?? [];
  const effort = effortsOfConfig(options);
  const efforts = effort ? effort.values : staticEfforts;
  const select = selectOf(options, "model");
  const list: { value: string; name: string }[] = select
    ? flatOptions(select)
    : session.models
      ? session.models.availableModels.map((m) => ({ value: m.modelId, name: m.name }))
      : [{ value: DEFAULT_MODEL, name: "Par défaut" }];
  const base = Math.floor(Date.now() / 1000);
  return list.map((o, i) => ({
    id: `${ACP_PREFIX}${agent}/${o.value}`,
    name: o.name,
    providerId: `${ACP_PREFIX}${agent}`,
    created: base - i,
    contextLength: null,
    variant: null,
    alias: false,
    efforts,
    defaultEffort: effort?.current ?? null,
    reasoningMandatory: true,
  }));
}

export const modelsOfConfig = (agent: AcpAgentId, options: SessionConfigOption[], staticEfforts: string[]) =>
  modelsOfSession(agent, { configOptions: options }, staticEfforts);

export function effortsOfConfig(options: SessionConfigOption[]): { configId: string; values: string[]; current: string } | null {
  const opt = selectOf(options, "thought_level");
  if (!opt) return null;
  return { configId: opt.id, values: flatOptions(opt).map((o) => o.value), current: opt.currentValue };
}

export const modelConfigId = (options: SessionConfigOption[]) => selectOf(options, "model")?.id ?? null;

/* --- Permissions --------------------------------------------------------- */

/** L'option a choisir pour repondre a `session/request_permission`. */
export function pickPermissionOption(options: PermissionOption[], allow: boolean, always: boolean): string | null {
  const kind = (k: PermissionOption["kind"]) => options.find((o) => o.kind === k)?.optionId ?? null;
  if (allow) return (always ? kind("allow_always") : null) ?? kind("allow_once") ?? kind("allow_always");
  return kind("reject_once") ?? kind("reject_always");
}
