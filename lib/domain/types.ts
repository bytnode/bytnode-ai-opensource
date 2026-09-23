/* ---------------------------------------------------------------------------
   The application's vocabulary. Nothing here depends on React, the browser
   or OpenRouter: these are the shapes everything else handles.
--------------------------------------------------------------------------- */

import type { Step, UsageInfo } from "@/lib/agent/events";
import type { Attachment } from "@/lib/agent/attachments";
import type { ProfessionId } from "@/lib/professions/catalog";
import type { PluginsState } from "./plugins";

export type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  /** A few lines about oneself, passed to every agent. */
  bio: string;
};

/** An account on a centralised exchange, driven by ccxt. The keys stay in
    the browser and travel by header with every tool request — never on
    the server's disk. */
export type ExchangeAccount = {
  id: string;
  /** The ccxt id: `binance`, `bybit`, `okx`… (see `lib/tools/exchange/catalog.ts`). */
  exchange: string;
  /** The name the agent uses to refer to this account: « Binance-main ». */
  label: string;
  apiKey: string;
  secret: string;
  /** The passphrase, for the exchanges that require one (OKX, KuCoin, Bitget). */
  password: string;
  /** True: the account is on the exchange's test network. */
  testnet: boolean;
};

/** One key per service: OpenRouter to chat (and search the web), BytNode
    for market data, and the exchange accounts the agents may act on. */
export type ApiKeys = {
  openrouter: string;
  bytnode: string;
  exchanges: ExchangeAccount[];
};

/** A file dropped into the agent's context: read once client-side, kept
    as text. */
export type ContextFile = {
  id: string;
  name: string;
  size: number;
  content: string;
};

export type AgentConfig = {
  id: string;
  createdAt: number;
  name: string;
  /** The agent's profession: its system prompt and its skills. */
  profession: ProfessionId;
  /** The chosen vendor (`anthropic`, `openai`…): the prefix of OpenRouter
      model ids. Or a subscription, `acp:claude` / `acp:openai` / `acp:gemini`
      (see `lib/acp/agents.ts`). */
  providerId: string;
  /** The model proposed when a conversation opens. `null` until the
      catalog has been read. */
  defaultModelId: string | null;
  /** The effort proposed when a conversation opens, if the current model
      accepts it. */
  defaultEffort?: string | null;
  /** The mode proposed when a conversation opens (subscription agents:
      « Plan », « Accept edits »…). */
  defaultMode?: string | null;
  contextText: string;
  contextFiles: ContextFile[];
  /** The agent's workspace: its sandbox. Empty = `sandboxes/<id>` in the
      project. */
  workspace?: string;
  /** `skip`: tools run without asking. `ask`: every shell command and every
      file modification waits for your approval. */
  permissionMode?: "skip" | "ask";
  /** `workspace`: the file tools do not leave the workspace. `disk`: the
      whole disk. */
  scope?: "workspace" | "disk";
  /** The permissions remembered by « Always »: a tool name (`Write`) or the
      start of a command (`Bash(git status *)`). They replace the old
      « allow everything » — see `lib/tools/permissions.ts`. */
  allowRules?: string[];
  /** The exchange accounts (ids from `ApiKeys.exchanges`) this agent may
      drive. Empty: no exchange tool in its prompt. */
  exchangeAccountIds?: string[];
};

export type Theme = "dark" | "light";

/** How the user connects to the models: through their API keys, or through
    a subscription (Claude, ChatGPT, Google) that gives access to the
    vendor's agent, driven by ACP. Both can coexist; this choice is the tab
    opened by default in the Authentication page. */
export type AuthMode = "subscription" | "keys";

export type Settings = {
  version: 4;
  onboardingDone: boolean;
  theme: Theme;
  profile: Profile;
  authMode: AuthMode;
  keys: ApiKeys;
  /** As many agents as wanted, each with its provider and its context. The
      left column lists them; conversations are attached to one of them. */
  agents: AgentConfig[];
  activeAgentId: string | null;
  /** Each plugin's switch, configuration and allowed agents, by id. A
      plugin absent from here is enabled with its defaults. */
  plugins: PluginsState;
};

export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** The model that produced the reply (assistant only). */
  modelId?: string;
  /** The effort requested for this reply, if it was set. */
  effort?: string;
  /** A reply interrupted by an error keeps what it received, and the
      error. */
  error?: string;
  /** The steps of an assistant reply that used tools: text and calls, in
      order. Absent for a text-only reply. */
  steps?: Step[];
  /** What the reply cost: tokens, price, provider. */
  usage?: UsageInfo;
  /** The files and captures the user attached to this message. */
  attachments?: Attachment[];
  /** This message asked for deep research. */
  research?: boolean;
  /** This message is the SUMMARY that replaced a compacted thread
      (`/compact`): the thread shows it as such, and the history replays it
      as a context reminder rather than as a reply. */
  compaction?: boolean;
  /** Who triggered it: `user` (/compact), `auto` (meter full at the end of
      a turn), `overflow` (the provider refused the context). Absent on old
      threads: means `user`. */
  compactedBy?: "user" | "auto" | "overflow";
  /** The compaction IN PROGRESS: the summary is being written into this
      message, which the thread shows as a status line and never as a
      reply. It is removed at the end of the turn (replaced by the summary,
      or deleted). */
  compacting?: boolean;
};

export type Conversation = {
  id: string;
  agentId: string;
  title: string;
  modelId: string;
  /** The reasoning effort requested, or `null` to leave the model at its
      default setting. */
  effort?: string | null;
  /** The external agent's mode for this conversation. */
  mode?: string | null;
  /** For a subscription agent: the ACP session that carries this
      conversation at the external agent, to reload after a restart. */
  acpSessionId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

/** A model from the OpenRouter catalog, reduced to what the interface needs. */
export type Model = {
  id: string;
  name: string;
  providerId: string;
  /** Release date, in Unix seconds (as provided by OpenRouter). */
  created: number;
  contextLength: number | null;
  /** The suffix after `:` (`free`, `batch`, `thinking`…): a variant of a
      base model, not a new model. */
  variant: string | null;
  /** True for `~vendor/…-latest` ids: a moving alias that OpenRouter points
      at the latest model, not a release. */
  alias: boolean;
  /** The reasoning effort levels the model accepts, in the order published
      by OpenRouter (`max`, `xhigh`, `high`, `medium`, `low`, `minimal`,
      `none`). Empty if the model does not reason. */
  efforts: string[];
  defaultEffort: string | null;
  /** True when the model always reasons: the effort can be set, not
      switched off. */
  reasoningMandatory: boolean;
};

export type Provider = {
  id: string;
  name: string;
  modelCount: number;
};
