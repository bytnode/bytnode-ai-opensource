import type { AgentConfig, Conversation, ExchangeAccount, Profile, Settings } from "@/lib/domain/types";
import type { PluginConfig, PluginSettings, PluginsState } from "@/lib/domain/plugins";
import { DEFAULT_PROFESSION, isProfessionId } from "@/lib/professions/catalog";
import type { Storage } from "./storage";

export const SETTINGS_KEY = "agentchat:settings";
export const CONVERSATIONS_KEY = "agentchat:conversations";

/* ⚠️ THE MIGRATED AGENT'S ID IS FIXED, AND THAT IS WHAT MAKES THE MIGRATION
   SAFE. v1 had only one agent and conversations with no `agentId`. The two
   repositories are read separately; for the old conversations to find
   their agent again, both have to agree on an id without talking to each
   other. */
export const LEGACY_AGENT_ID = "agent-1";

export function defaultSettings(): Settings {
  return {
    version: 4,
    onboardingDone: false,
    theme: "dark",
    profile: { firstName: "", lastName: "", email: "", bio: "" },
    authMode: "subscription",
    keys: { openrouter: "", bytnode: "", exchanges: [] },
    agents: [],
    activeAgentId: null,
    plugins: {},
  };
}

/** A blank agent, with no id: the id and the date are set at creation, by
    whoever saves it. */
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
    exchangeAccountIds: [],
    contextText: "",
    contextFiles: [],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Rebuilds full settings from what was read: each missing field falls back
    to its default value, so that a setting added in a future version does
    not break a past version's data. */
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
    exchangeAccountIds: Array.isArray(raw.exchangeAccountIds) ? raw.exchangeAccountIds.filter((r): r is string => typeof r === "string") : [],
    contextText: str(raw.contextText),
    contextFiles: files
      .filter(isRecord)
      .map((f) => ({ id: str(f.id), name: str(f.name), size: typeof f.size === "number" ? f.size : 0, content: str(f.content) })),
  };
}

/** A readable exchange account: id and exchange present. The other entries
    are dropped without complaint. */
function normalizeExchangeAccount(raw: unknown): ExchangeAccount | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const exchange = str(raw.exchange);
  if (!id || !exchange) return null;
  return {
    id,
    exchange,
    label: str(raw.label, exchange),
    apiKey: str(raw.apiKey),
    secret: str(raw.secret),
    password: str(raw.password),
    testnet: raw.testnet === true,
  };
}

/** A plugin's settings as read: a switch (on unless explicitly off), a flat
    configuration of simple values, and the allowed agents (`null` = all).
    The values are checked against the plugin's schema where it runs
    (`lib/plugins/core/state.ts`). */
function normalizePlugin(raw: unknown): PluginSettings | null {
  if (!isRecord(raw)) return null;
  const config: PluginConfig = {};
  if (isRecord(raw.config)) {
    for (const [k, v] of Object.entries(raw.config)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") config[k] = v;
  }
  return {
    enabled: raw.enabled !== false,
    config,
    agentIds: Array.isArray(raw.agentIds) ? raw.agentIds.filter((a): a is string => typeof a === "string") : null,
  };
}

function normalizePlugins(raw: unknown): PluginsState {
  if (!isRecord(raw)) return {};
  const out: PluginsState = {};
  for (const [id, value] of Object.entries(raw)) {
    const p = normalizePlugin(value);
    if (p) out[id] = p;
  }
  return out;
}

/** Full settings from anything read (storage, a request body): each
    missing or malformed field falls back to its default. */
export function normalizeSettings(raw: unknown): Settings {
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

  /* v2: a list. v1: a single `agent`, which becomes the first of the list
     under the agreed id. */
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
    version: 4,
    onboardingDone: raw.onboardingDone === true,
    theme: raw.theme === "light" ? "light" : "dark",
    profile: p,
    /* An account from before this choice existed has a key: it stays on keys. */
    authMode: raw.authMode === "subscription" || raw.authMode === "keys" ? raw.authMode : str(keys.openrouter) ? "keys" : "subscription",
    keys: {
      openrouter: str(keys.openrouter),
      bytnode: str(keys.bytnode),
      exchanges: Array.isArray(keys.exchanges) ? keys.exchanges.map(normalizeExchangeAccount).filter((a): a is ExchangeAccount => a !== null) : [],
    },
    agents,
    activeAgentId,
    /* v4: the plugins. Before, none was configured: all start enabled. */
    plugins: normalizePlugins(raw.plugins),
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

/** The browser's storage is full: the conversation was not written, the
    old list is intact. */
export class StorageFullError extends Error {
  constructor() {
    super("The browser's storage is full.");
    this.name = "StorageFullError";
  }
}

/** The same list without the inline images: they stay on disk (`path`),
    and the thread reloads them through `/api/files`. */
function withoutInlineImages(list: Conversation[]): Conversation[] {
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m) =>
      m.attachments?.some((a) => a.dataUrl)
        ? { ...m, attachments: m.attachments.map((a) => (a.dataUrl ? { ...a, dataUrl: undefined } : a)) }
        : m,
    ),
  }));
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

  /* ⚠️ A WRITE CAN FAIL (quota). So we lighten it — the inline images
     first, they are what weighs it down — and retry; if it still does not
     fit, we say so instead of silently losing the turn. */
  private write(list: Conversation[]) {
    if (this.storage.set(CONVERSATIONS_KEY, JSON.stringify(list))) return;
    if (this.storage.set(CONVERSATIONS_KEY, JSON.stringify(withoutInlineImages(list)))) return;
    throw new StorageFullError();
  }
}
