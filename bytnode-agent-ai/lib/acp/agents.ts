/* ---------------------------------------------------------------------------
   Les agents ACP que BytNode-AI sait piloter par abonnement.

   Un abonnement (Claude Pro / Max, ChatGPT Plus / Pro, Google, GitHub
   Copilot, SuperGrok, Mistral…) ne donne pas de cle API : il donne acces a
   l'agent de l'editeur — Claude Code, Codex, Gemini CLI, Copilot CLI,
   Grok Build, Mistral Vibe. Ces agents parlent l'Agent Client
   Protocol (JSON-RPC sur stdio) ; BytNode-AI les lance en sous-processus et
   les habille de son prompt, de ses competences et de sa source de donnees.

   Ce fichier est partage navigateur / serveur : rien de Node ici.
   Le nom affiche est celui de l'EDITEUR (« Claude », « OpenAI »), pas celui
   du produit — l'utilisateur choisit a qui il est abonne.
--------------------------------------------------------------------------- */

export type AcpAgentId = "claude" | "openai" | "gemini" | "copilot" | "grok" | "mistral";

export type AcpAgentInfo = {
  id: AcpAgentId;
  /** Ce que l'interface affiche. */
  label: string;
  /** Le produit reellement lance, pour les libelles secondaires. */
  product: string;
  /** L'abonnement attendu. */
  plan: string;
  /** L'identifiant de fournisseur porte par un agent BytNode-AI
      (`AgentConfig.providerId`) et prefixe des ids de modeles. */
  providerId: string;
  /** Les niveaux d'effort fixes quand l'agent ne les publie pas dans ses
      options de session (Claude Code : un reglage a la creation). */
  staticEfforts: string[];
};

export const ACP_PREFIX = "acp:";

export const ACP_AGENTS: AcpAgentInfo[] = [
  {
    id: "claude",
    label: "Claude",
    product: "Claude Code",
    plan: "Claude Pro ou Max",
    providerId: `${ACP_PREFIX}claude`,
    staticEfforts: ["max", "xhigh", "high", "medium", "low"],
  },
  {
    id: "openai",
    label: "OpenAI",
    product: "Codex",
    plan: "ChatGPT Plus, Pro ou Business",
    providerId: `${ACP_PREFIX}openai`,
    staticEfforts: [],
  },
  {
    id: "gemini",
    label: "Gemini",
    product: "Gemini CLI",
    plan: "Compte Google",
    providerId: `${ACP_PREFIX}gemini`,
    staticEfforts: [],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    product: "Copilot CLI",
    plan: "GitHub Copilot Pro, Pro+ ou Business",
    providerId: `${ACP_PREFIX}copilot`,
    staticEfforts: [],
  },
  {
    id: "grok",
    label: "Grok",
    product: "Grok Build",
    plan: "SuperGrok ou X Premium",
    providerId: `${ACP_PREFIX}grok`,
    staticEfforts: [],
  },
  {
    id: "mistral",
    label: "Mistral",
    product: "Mistral Vibe",
    plan: "Compte Mistral AI Studio",
    providerId: `${ACP_PREFIX}mistral`,
    staticEfforts: [],
  },
];

export const isAcpAgentId = (v: unknown): v is AcpAgentId => ACP_AGENTS.some((a) => a.id === v);

export const isAcpProvider = (providerId: string | null | undefined) => !!providerId && providerId.startsWith(ACP_PREFIX);

/** L'agent ACP derriere un fournisseur `acp:<id>`, ou null. */
export function acpAgentOf(providerId: string | null | undefined): AcpAgentInfo | null {
  if (!isAcpProvider(providerId)) return null;
  const id = providerId!.slice(ACP_PREFIX.length);
  return ACP_AGENTS.find((a) => a.id === id) ?? null;
}

export const acpAgentInfo = (id: AcpAgentId): AcpAgentInfo => ACP_AGENTS.find((a) => a.id === id)!;

/** L'id de modele tel que l'agent ACP le connait, depuis notre id prefixe
    `acp:<agent>/<modele>`. */
export function acpModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return isAcpProvider(modelId) && slash > 0 ? modelId.slice(slash + 1) : modelId;
}

/** L'etat d'un agent, tel que le serveur le rapporte. */
export type AcpAuthStatus = {
  agent: AcpAgentId;
  /** L'agent est lancable sur cette machine (pose par « Installer » dans
      ~/.bytnode-ai/agents, ou CLI global trouve sur le PATH — `packages.ts`). */
  available: boolean;
  /** D'ou il vient, quand il est disponible. */
  source?: "installed" | "global";
  /** La version installee ne satisfait plus la plage attendue par cette
      version de BytNode-AI : « Mettre a jour ». */
  outdated?: boolean;
  /** Une installation est en cours. */
  installing?: boolean;
  /** L'etat du compte n'est pas encore connu : la lecture se fait en
      arriere-plan (agents sans ligne de commande d'etat, qu'il faut
      interroger par le protocole). */
  checking?: boolean;
  loggedIn: boolean;
  /** Ce que l'agent sait du compte : e-mail, type d'abonnement… */
  account?: string | null;
  /** Une connexion est en cours (fenetre ou navigateur ouvert). */
  connecting?: boolean;
  message?: string | null;
};
