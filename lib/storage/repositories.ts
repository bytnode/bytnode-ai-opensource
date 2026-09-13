import type { AgentConfig, Conversation, Profile, Settings } from "@/lib/domain/types";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import type { Storage } from "./storage";

export const SETTINGS_KEY = "agentchat:settings";
export const CONVERSATIONS_KEY = "agentchat:conversations";

/* ⚠️ L'ID DE L'AGENT MIGRE EST FIXE, ET C'EST CE QUI REND LA MIGRATION SURE.
   La v1 n'avait qu'un agent et des conversations sans `agentId`. Les deux
   depots sont lus separement ; pour que les anciennes conversations
   retrouvent leur agent, il faut que l'un et l'autre s'accordent sur un id
   sans se parler. */
export const LEGACY_AGENT_ID = "agent-1";

export function defaultSettings(): Settings {
  return {
    version: 2,
    onboardingDone: false,
    theme: "dark",
    profile: { firstName: "", lastName: "", email: "", bio: "" },
    authMode: "subscription",
    keys: { openrouter: "", bytnode: "" },
    agents: [],
    activeAgentId: null,
  };
}

/** Un agent vide, sans id : l'id et la date sont poses a la creation, par
    celui qui l'enregistre. */
export function blankAgent(): AgentConfig {
  return {
    id: "",
    createdAt: 0,
    name: "",
    profession: DEFAULT_PROFESSION,
    providerId: "",
    defaultModelId: null,
    defaultEffort: null,
    workspace: "",
    permissionMode: "ask",
    scope: "workspace",
    allowRules: [],
    contextText: "",
    contextFiles: [],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Recompose des reglages complets a partir de ce qui a ete lu : chaque champ
    manquant reprend sa valeur par defaut, de sorte qu'un reglage ajoute dans
    une version future ne casse pas les donnees d'une version passee. */
function normalizeAgent(raw: unknown, fallbackId: string): AgentConfig | null {
  if (!isRecord(raw)) return null;
  const files = Array.isArray(raw.contextFiles) ? raw.contextFiles : [];
  return {
    id: str(raw.id, fallbackId),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    name: str(raw.name),
    profession: isProfessionId(raw.profession) ? raw.profession : DEFAULT_PROFESSION,
    providerId: str(raw.providerId),
    defaultModelId: typeof raw.defaultModelId === "string" ? raw.defaultModelId : null,
    defaultEffort: typeof raw.defaultEffort === "string" ? raw.defaultEffort : null,
    workspace: str(raw.workspace),
    permissionMode: raw.permissionMode === "skip" ? "skip" : "ask",
    scope: raw.scope === "disk" ? "disk" : "workspace",
    allowRules: Array.isArray(raw.allowRules) ? raw.allowRules.filter((r): r is string => typeof r === "string") : [],
    contextText: str(raw.contextText),
    contextFiles: files
      .filter(isRecord)
      .map((f) => ({ id: str(f.id), name: str(f.name), size: typeof f.size === "number" ? f.size : 0, content: str(f.content) })),
  };
}

function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(raw)) return d;
  const profile = isRecord(raw.profile) ? raw.profile : {};
  const keys = isRecord(raw.keys) ? raw.keys : {};
  const p: Profile = {
    firstName: str(profile.firstName),
    lastName: str(profile.lastName),
    email: str(profile.email),
    bio: str(profile.bio),
  };

  /* v2 : une liste. v1 : un seul `agent`, qui devient le premier de la liste
     sous l'id convenu. */
  let agents: AgentConfig[] = [];
  if (Array.isArray(raw.agents)) {
    agents = raw.agents.map((a, i) => normalizeAgent(a, `agent-${i + 1}`)).filter((a): a is AgentConfig => a !== null);
  } else if (isRecord(raw.agent)) {
    const legacy = normalizeAgent({ ...raw.agent, id: LEGACY_AGENT_ID }, LEGACY_AGENT_ID);
    if (legacy) agents = [legacy];
  }

  const wanted = typeof raw.activeAgentId === "string" ? raw.activeAgentId : null;
  const activeAgentId = agents.some((a) => a.id === wanted) ? wanted : (agents[0]?.id ?? null);

  return {
    version: 2,
    onboardingDone: raw.onboardingDone === true,
    theme: raw.theme === "light" ? "light" : "dark",
    profile: p,
    /* Un compte d'avant ce choix a une cle : il reste sur les cles. */
    authMode: raw.authMode === "subscription" || raw.authMode === "keys" ? raw.authMode : str(keys.openrouter) ? "keys" : "subscription",
    keys: { openrouter: str(keys.openrouter), bytnode: str(keys.bytnode) },
    agents,
    activeAgentId,
  };
}

export class SettingsRepository {
  constructor(private storage: Storage) {}

  load(): Settings {
    const raw = this.storage.get(SETTINGS_KEY);
    if (raw === null) return defaultSettings();
    try {
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return defaultSettings();
    }
  }

  save(settings: Settings) {
    this.storage.set(SETTINGS_KEY, JSON.stringify(settings));
  }
}

export class ConversationsRepository {
  constructor(private storage: Storage) {}

  list(): Conversation[] {
    const raw = this.storage.get(CONVERSATIONS_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return (parsed as Conversation[])
        .map((c) => (typeof c.agentId === "string" ? c : { ...c, agentId: LEGACY_AGENT_ID }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  save(conversation: Conversation) {
    const others = this.list().filter((c) => c.id !== conversation.id);
    this.write([conversation, ...others]);
  }

  remove(id: string) {
    this.write(this.list().filter((c) => c.id !== id));
  }

  private write(list: Conversation[]) {
    this.storage.set(CONVERSATIONS_KEY, JSON.stringify(list));
  }
}
