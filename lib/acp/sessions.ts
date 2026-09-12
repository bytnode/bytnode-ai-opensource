import type { McpServer, PermissionOption, SessionConfigOption } from "@agentclientprotocol/sdk";
import fs from "node:fs";
import path from "node:path";
import { BYTNODE_MCP_URL } from "@/lib/mcp/bytnode";
import { PROJECT_ROOT } from "@/lib/server/workspace";
import { acpAgentInfo, type AcpAgentId } from "./agents";
import { AcpConnection } from "./connection";
import { prepareWorkspace } from "./prepare";
import { wrapContext } from "./prompt";
import { DEFAULT_MODEL, effortsOfConfig, eventsOfUpdate, modelConfigId, modesOfSession, pickPermissionOption, type AgentModes } from "./translate";

/* ---------------------------------------------------------------------------
   Une session ACP par conversation.

   Le sous-processus de l'agent vit tant que la conversation est active et
   meurt apres un quart d'heure de silence. S'il est mort quand on revient,
   la session est rechargee (`session/load`) : l'agent rejoue son historique
   — qu'on ignore, le fil l'a deja — et reprend ou il en etait.

   Un tour = un `session/prompt`. Pendant le tour, l'agent raconte
   (`session/update`) et demande parfois la permission d'agir ; ces demandes
   sont posees a l'ecran et attendent la reponse de l'utilisateur, arrivee
   par une autre requete (`answerPermission`).
--------------------------------------------------------------------------- */

import type { WireEvent } from "./wire";
export type { WireEvent };

export type TurnInput = {
  conversationId: string;
  agent: AcpAgentId;
  workspace: string;
  bytnodeKey: string;
  /** Le prompt systeme de BytNode-AI (profil, profession, environnement). */
  system: string;
  text: string;
  /** L'id de modele tel que l'agent le connait (sans prefixe), ou null. */
  modelId: string | null;
  effort: string | null;
  /** Le mode de l'agent externe demande pour ce tour, s'il en publie. */
  mode: string | null;
  permissionMode: "ask" | "skip";
  /** La session memorisee par la conversation, a recharger si possible. */
  sessionId: string | null;
  /** Vrai au premier message de la conversation. */
  firstTurn: boolean;
  /** Le fil precedent en texte, pour un agent qui ne sait pas recharger. */
  history?: string;
};

type Pending = { options: PermissionOption[]; resolve: (optionId: string | null) => void };

type Live = {
  agent: AcpAgentId;
  conn: AcpConnection;
  sessionId: string;
  cwd: string;
  configOptions: SessionConfigOption[];
  /** L'ancien champ `models` (Gemini CLI) : le modele courant, s'il y en a. */
  legacyModel: string | null;
  /** Les modes que la session publie, et celui qui est actif. */
  modes: AgentModes | null;
  /** L'effort applique a la creation (Claude) : un changement exige une
      nouvelle session. */
  effort: string | null;
  /** Les serveurs MCP donnes a la creation : s'ils changent (cle BytNode
      saisie, nouveaux outils), la session est refaite — un agent ne
      decouvre pas de serveur en cours de route. */
  serversKey: string;
  /** Le prompt systeme pose a la creation : s'il change (profession,
      contexte, competences), la session est refaite, sinon l'agent
      continuerait avec l'ancien metier. */
  system: string;
  lastUsed: number;
  busy: boolean;
  pending: Map<string, Pending>;
  /** Vrai pendant `session/load` : les mises a jour rejouees sont ignorees. */
  loading: boolean;
};

const IDLE_TTL = 15 * 60_000;
const live = new Map<string, Live>();

let reaper: NodeJS.Timeout | null = null;
function armReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, l] of live) {
      if (!l.busy && now - l.lastUsed > IDLE_TTL) {
        l.conn.close();
        live.delete(id);
      }
    }
    if (live.size === 0 && reaper) {
      clearInterval(reaper);
      reaper = null;
    }
  }, 60_000).unref();
}

/* Les serveurs MCP donnes a l'agent externe : BytNode (donnees) et les
   outils financiers de BytNode-AI (SaveMarketData, Chart, Backtest, Memory),
   servis par un petit processus stdio dans le dossier de travail. */
/* La version du code des outils : la date du fichier le plus recent. Elle
   entre dans l'environnement du serveur, donc dans la cle de session — une
   modification des outils recree la session, et l'agent relance le serveur
   avec le code a jour au lieu de garder l'ancien processus. */
function toolsVersion(): string {
  const dir = path.join(PROJECT_ROOT, "lib", "tools", "finance");
  let latest = 0;
  const visit = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) visit(p);
      else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try {
    visit(dir);
    latest = Math.max(latest, fs.statSync(path.join(PROJECT_ROOT, "lib", "mcp", "finance-server.ts")).mtimeMs);
  } catch {
    /* pas grave : la cle ne bougera pas */
  }
  return String(Math.floor(latest));
}

const mcpServersFor = (workspace: string, bytnodeKey: string): McpServer[] => {
  const servers: McpServer[] = [
    {
      name: "bytnode-ai",
      command: process.execPath,
      args: [
        path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
        /* Le tsconfig du projet, explicitement : l'agent lance ce serveur
           dans le dossier de travail, et les alias `@/` doivent se resoudre
           depuis le projet — pas depuis la ou le processus demarre. */
        "--tsconfig",
        path.join(PROJECT_ROOT, "tsconfig.json"),
        path.join(PROJECT_ROOT, "lib", "mcp", "finance-server.ts"),
      ],
      env: [
        { name: "BYTNODE_AI_WORKSPACE", value: workspace },
        { name: "BYTNODE_AI_PROJECT_ROOT", value: PROJECT_ROOT },
        { name: "BYTNODE_AI_BYTNODE_KEY", value: bytnodeKey.trim() },
        { name: "BYTNODE_AI_TOOLS_VERSION", value: toolsVersion() },
      ],
    },
  ];
  if (bytnodeKey.trim()) servers.push({ type: "http", name: "bytnode", url: BYTNODE_MCP_URL, headers: [{ name: "X-API-KEY", value: bytnodeKey.trim() }] });
  return servers;
};

/** Ce que chaque agent accepte a la creation d'une session, hors protocole. */
function sessionMeta(agent: AcpAgentId, input: TurnInput): Record<string, unknown> | undefined {
  if (agent !== "claude") return undefined;
  /* Sans les reglages personnels de l'utilisateur (`~/.claude/settings.json`) :
     leurs regles d'autorisation et leur modele ne doivent pas s'appliquer
     ici — c'est BytNode-AI qui decide, avec ses deux modes. */
  /* Et seulement NOS serveurs MCP : sans `strictMcpConfig`, Claude Code
     charge aussi les connecteurs du compte claude.ai de l'utilisateur
     (Gmail, agenda…) — hors sujet ici, et des dizaines d'outils de bruit. */
  const options: Record<string, unknown> = { settingSources: ["project", "local"], strictMcpConfig: true };
  if (input.modelId) options.model = input.modelId;
  if (input.effort) options.effort = input.effort;
  return { systemPrompt: { append: input.system }, claudeCode: { options } };
}

async function ensureSession(input: TurnInput): Promise<{ l: Live; fresh: boolean; loaded: boolean }> {
  const current = live.get(input.conversationId);
  const servers = mcpServersFor(input.workspace, input.bytnodeKey);
  const serversKey = JSON.stringify(servers);
  if (
    current &&
    current.conn.alive &&
    current.serversKey === serversKey &&
    current.system === input.system &&
    (current.agent !== "claude" || current.effort === input.effort)
  ) {
    return { l: current, fresh: false, loaded: false };
  }
  if (current) {
    current.conn.close();
    live.delete(input.conversationId);
  }
  await prepareWorkspace(input.agent, input.workspace);
  const conn = await AcpConnection.open(input.agent, input.workspace);
  const meta = sessionMeta(input.agent, input);
  const l: Live = {
    agent: input.agent,
    conn,
    sessionId: "",
    cwd: input.workspace,
    configOptions: [],
    legacyModel: null,
    modes: null,
    effort: input.effort,
    serversKey,
    system: input.system,
    lastUsed: Date.now(),
    busy: false,
    pending: new Map(),
    loading: false,
  };
  let loaded = false;
  if (input.sessionId && conn.capabilities.loadSession) {
    try {
      l.loading = true;
      conn.listen(input.sessionId, () => {}, async () => ({ outcome: { outcome: "cancelled" } }));
      const res = await conn.loadSession(input.sessionId, input.workspace, servers, meta);
      l.sessionId = input.sessionId;
      l.configOptions = res.configOptions ?? [];
      l.legacyModel = legacyModelOf(res);
      l.modes = modesOfSession(res as Parameters<typeof modesOfSession>[0]);
      loaded = true;
    } catch {
      /* session inconnue de l'agent : on en ouvre une neuve */
    } finally {
      l.loading = false;
      conn.listen(input.sessionId, null, null);
    }
  }
  if (!loaded) {
    try {
      const res = await conn.newSession(input.workspace, servers, meta);
      l.sessionId = res.sessionId;
      l.configOptions = res.configOptions ?? [];
      l.legacyModel = legacyModelOf(res);
      l.modes = modesOfSession(res as Parameters<typeof modesOfSession>[0]);
    } catch (e) {
      conn.close();
      throw describe(e, conn);
    }
  }
  live.set(input.conversationId, l);
  armReaper();
  return { l, fresh: !loaded, loaded };
}

const legacyModelOf = (res: unknown): string | null => {
  const m = (res as { models?: { currentModelId?: string } | null }).models;
  return m && typeof m.currentModelId === "string" ? m.currentModelId : null;
};

function describe(e: unknown, conn: AcpConnection): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const detail = conn.lastStderr;
  if (/auth/i.test(msg)) return new Error(`${acpAgentInfo(conn.agent).label} demande une connexion au compte : ouvrez Authentification → Abonnement.`);
  return new Error(detail ? `${msg}\n${detail}` : msg);
}

/** Applique modele et effort par les options de session, quand l'agent les
    publie ; sans bruit si rien ne change. */
async function applyConfig(l: Live, input: TurnInput) {
  const modelCfg = modelConfigId(l.configOptions);
  const effortCfg = effortsOfConfig(l.configOptions);
  const current = (id: string) => {
    const o = l.configOptions.find((c) => c.id === id);
    return o && o.type === "select" ? o.currentValue : null;
  };
  const wanted = input.modelId && input.modelId !== DEFAULT_MODEL ? input.modelId : null;
  try {
    if (modelCfg && wanted && current(modelCfg) !== wanted) {
      const res = await l.conn.setConfig(l.sessionId, modelCfg, wanted);
      l.configOptions = res.configOptions ?? l.configOptions;
    } else if (!modelCfg && l.legacyModel !== null && wanted && l.legacyModel !== wanted) {
      await l.conn.setModel(l.sessionId, wanted);
      l.legacyModel = wanted;
    }
    if (effortCfg && input.effort && effortCfg.values.includes(input.effort) && effortCfg.current !== input.effort) {
      const res = await l.conn.setConfig(l.sessionId, effortCfg.configId, input.effort);
      l.configOptions = res.configOptions ?? l.configOptions;
    }
    /* Le mode : par l'option de configuration quand l'agent en a une,
       sinon par `session/set_mode`. */
    const modes = l.modes;
    if (modes && input.mode && input.mode !== modes.current && modes.options.some((o) => o.value === input.mode)) {
      if (modes.configId) {
        const res = await l.conn.setConfig(l.sessionId, modes.configId, input.mode);
        l.configOptions = res.configOptions ?? l.configOptions;
      } else await l.conn.setMode(l.sessionId, input.mode);
      l.modes = { ...modes, current: input.mode };
    }
  } catch {
    /* un reglage refuse n'empeche pas le tour */
  }
}

export async function runTurn(input: TurnInput, emit: (e: WireEvent) => void, signal: AbortSignal): Promise<void> {
  const { l, fresh } = await ensureSession(input);
  if (l.busy) throw new Error("Cette conversation a déjà un tour en cours.");
  l.busy = true;
  l.lastUsed = Date.now();
  emit({ type: "session", sessionId: l.sessionId });
  await applyConfig(l, input);

  let text = input.text;
  if (input.agent !== "claude" && (input.firstTurn || fresh)) {
    const system = input.history && !input.firstTurn ? `${input.system}\n\n## Fil précédent\n${input.history}` : input.system;
    text = wrapContext(system, text);
  } else if (input.agent === "claude" && fresh && !input.firstTurn && input.history) {
    text = `<fil_precedent>\n${input.history}\n</fil_precedent>\n\n${text}`;
  }

  const onAbort = () => {
    void l.conn.cancel(l.sessionId).catch(() => {});
    for (const p of l.pending.values()) p.resolve(null);
    l.pending.clear();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  l.conn.listen(
    l.sessionId,
    (n) => {
      if (l.loading) return;
      for (const e of eventsOfUpdate(n.update)) emit(e);
    },
    async (req) => {
      const auto = input.permissionMode === "skip";
      const id = req.toolCall.toolCallId;
      if (auto) {
        const optionId = pickPermissionOption(req.options, true, false);
        return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
      }
      const optionId = await new Promise<string | null>((resolve) => {
        l.pending.set(id, { options: req.options, resolve });
        emit({ type: "permission", id, title: req.toolCall.title ?? "", options: req.options });
      });
      l.pending.delete(id);
      return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    },
  );

  try {
    const res = await l.conn.prompt(l.sessionId, text);
    emit({ type: "done", finishReason: res.stopReason });
  } catch (e) {
    if (!signal.aborted) throw describe(e, l.conn);
    emit({ type: "done", finishReason: "cancelled" });
  } finally {
    signal.removeEventListener("abort", onAbort);
    l.conn.listen(l.sessionId, null, null);
    l.busy = false;
    l.lastUsed = Date.now();
    if (!l.conn.alive) live.delete(input.conversationId);
  }
}

/** La reponse de l'utilisateur a une demande de permission. */
export function answerPermission(conversationId: string, callId: string, allow: boolean, always: boolean): boolean {
  const l = live.get(conversationId);
  const p = l?.pending.get(callId);
  if (!p) return false;
  p.resolve(pickPermissionOption(p.options, allow, always));
  return true;
}

export function cancelTurn(conversationId: string): void {
  const l = live.get(conversationId);
  if (!l) return;
  void l.conn.cancel(l.sessionId).catch(() => {});
  for (const p of l.pending.values()) p.resolve(null);
  l.pending.clear();
}

export function closeConversation(conversationId: string): void {
  const l = live.get(conversationId);
  if (!l) return;
  l.conn.close();
  live.delete(conversationId);
}
