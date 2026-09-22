/* ---------------------------------------------------------------------------
   The ACP agents BytNode-AI can drive through a subscription.

   A subscription (Claude Pro / Max, ChatGPT Plus / Pro, Google, GitHub
   Copilot, SuperGrok, Mistral…) does not give an API key: it gives access
   to the vendor's agent — Claude Code, Codex, Gemini CLI, Copilot CLI,
   Grok Build, Mistral Vibe. These agents speak the Agent Client Protocol
   (JSON-RPC over stdio); BytNode-AI spawns them as sub-processes and
   dresses them with its prompt, its skills and its data source.

   This file is shared browser / server: nothing from Node here.
   The displayed name is the VENDOR's (« Claude », « OpenAI »), not the
   product's — the user picks who they are subscribed to.
--------------------------------------------------------------------------- */

export type AcpAgentId = "claude" | "openai" | "gemini" | "copilot" | "grok";

export type AcpAgentInfo = {
  id: AcpAgentId;
  /** What the interface displays. */
  label: string;
  /** The product actually launched, for secondary labels. */
  product: string;
  /** The expected subscription. */
  plan: string;
  /** The provider id carried by a BytNode-AI agent
      (`AgentConfig.providerId`) and prefix of the model ids. */
  providerId: string;
  /** The fixed effort levels when the agent does not publish them in its
      session options (Claude Code: a setting fixed at creation). */
  staticEfforts: string[];
};

export const ACP_PREFIX = "acp:";

export const ACP_AGENTS: AcpAgentInfo[] = [
  {
    id: "claude",
    label: "Claude",
    product: "Claude Code",
    plan: "Claude Pro or Max",
    providerId: `${ACP_PREFIX}claude`,
    staticEfforts: ["max", "xhigh", "high", "medium", "low"],
  },
  {
    id: "openai",
    label: "OpenAI",
    product: "Codex",
    plan: "ChatGPT Plus, Pro or Business",
    providerId: `${ACP_PREFIX}openai`,
    staticEfforts: [],
  },
  {
    id: "gemini",
    label: "Gemini",
    product: "Gemini CLI",
    plan: "Google account",
    providerId: `${ACP_PREFIX}gemini`,
    staticEfforts: [],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    product: "Copilot CLI",
    plan: "GitHub Copilot Pro, Pro+ or Business",
    providerId: `${ACP_PREFIX}copilot`,
    staticEfforts: [],
  },
  {
    id: "grok",
    label: "Grok",
    product: "Grok Build",
    plan: "SuperGrok or X Premium",
    providerId: `${ACP_PREFIX}grok`,
    staticEfforts: [],
  },
];

export const isAcpAgentId = (v: unknown): v is AcpAgentId => ACP_AGENTS.some((a) => a.id === v);

export const isAcpProvider = (providerId: string | null | undefined) => !!providerId && providerId.startsWith(ACP_PREFIX);

/** The ACP agent behind an `acp:<id>` provider, or null. */
export function acpAgentOf(providerId: string | null | undefined): AcpAgentInfo | null {
  if (!isAcpProvider(providerId)) return null;
  const id = providerId!.slice(ACP_PREFIX.length);
  return ACP_AGENTS.find((a) => a.id === id) ?? null;
}

export const acpAgentInfo = (id: AcpAgentId): AcpAgentInfo => ACP_AGENTS.find((a) => a.id === id)!;

/** The model id as the ACP agent knows it, from our prefixed id
    `acp:<agent>/<model>`. */
export function acpModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return isAcpProvider(modelId) && slash > 0 ? modelId.slice(slash + 1) : modelId;
}

/** The state of an agent, as the server reports it. */
export type AcpAuthStatus = {
  agent: AcpAgentId;
  /** The agent can be launched on this machine (put there by « Install » in
      ~/.bytnode-ai/agents, or a global CLI found on the PATH — `packages.ts`). */
  available: boolean;
  /** Where it comes from, when it is available. */
  source?: "installed" | "global";
  /** The installed version no longer satisfies the range this version of
      BytNode-AI expects: « Update ». */
  outdated?: boolean;
  /** An installation is in progress. */
  installing?: boolean;
  /** The account state is not known yet: it is being read in the
      background (agents with no status command line, which have to be
      probed through the protocol). */
  checking?: boolean;
  loggedIn: boolean;
  /** What the agent knows about the account: e-mail, subscription type… */
  account?: string | null;
  /** A sign-in is in progress (terminal window or browser open). */
  connecting?: boolean;
  message?: string | null;
};
