/* ---------------------------------------------------------------------------
   Le vocabulaire de l'application. Rien ici ne depend de React, du navigateur
   ni d'OpenRouter : ce sont les formes que tout le reste manipule.
--------------------------------------------------------------------------- */

import type { Step, UsageInfo } from "@/lib/agent/events";
import type { Attachment } from "@/lib/agent/attachments";
import type { ProfessionId } from "@/lib/professions/catalog";

export type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  /** Quelques lignes sur soi, transmises a chaque agent. */
  bio: string;
};

/** Un compte sur un exchange centralise, pilote par ccxt. Les cles restent
    dans le navigateur et voyagent par en-tete a chaque requete d'outil —
    jamais sur le disque du serveur. */
export type ExchangeAccount = {
  id: string;
  /** L'id ccxt : `binance`, `bybit`, `okx`… (voir `lib/tools/exchange/catalog.ts`). */
  exchange: string;
  /** Le nom que l'agent emploie pour designer ce compte : « Binance-main ». */
  label: string;
  apiKey: string;
  secret: string;
  /** La passphrase, pour les exchanges qui en demandent (OKX, KuCoin, Bitget). */
  password: string;
  /** Vrai : le compte est sur le reseau de test de l'exchange. */
  testnet: boolean;
};

/** Une cle par service : OpenRouter pour dialoguer (et chercher sur le
    web), BytNode pour les donnees de marche, et les comptes d'exchanges
    sur lesquels les agents peuvent agir. */
export type ApiKeys = {
  openrouter: string;
  bytnode: string;
  exchanges: ExchangeAccount[];
};

/** Un fichier depose dans le contexte de l'agent : lu une fois cote client,
    conserve en texte. */
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
  /** Le metier de l'agent : son prompt systeme et ses competences. */
  profession: ProfessionId;
  /** L'editeur choisi (`anthropic`, `openai`…) : le prefixe des ids de modeles
      OpenRouter. Ou un abonnement, `acp:claude` / `acp:openai` / `acp:gemini`
      (voir `lib/acp/agents.ts`). */
  providerId: string;
  /** Le modele propose a l'ouverture d'une conversation. `null` tant que le
      catalogue n'a pas ete lu. */
  defaultModelId: string | null;
  /** L'effort propose a l'ouverture d'une conversation, s'il est accepte par
      le modele du moment. */
  defaultEffort?: string | null;
  /** Le mode propose a l'ouverture d'une conversation (agents par
      abonnement : « Plan », « Accepter les modifications »…). */
  defaultMode?: string | null;
  contextText: string;
  contextFiles: ContextFile[];
  /** Le dossier de travail de l'agent : sa sandbox. Vide = `sandboxes/<id>`
      dans le projet. */
  workspace?: string;
  /** `skip` : les outils s'executent sans demander. `ask` : chaque commande
      shell et chaque modification de fichier attend votre accord. */
  permissionMode?: "skip" | "ask";
  /** `workspace` : les outils fichiers ne sortent pas du dossier de travail.
      `disk` : tout le disque. */
  scope?: "workspace" | "disk";
  /** Les autorisations memorisees par « Toujours » : un nom d'outil
      (`Write`) ou un debut de commande (`Bash(git status *)`). Elles
      remplacent l'ancien « tout autoriser » — voir
      `lib/tools/permissions.ts`. */
  allowRules?: string[];
  /** Les comptes d'exchange (ids de `ApiKeys.exchanges`) que cet agent peut
      piloter. Vide : aucun outil exchange dans son prompt. */
  exchangeAccountIds?: string[];
};

export type Theme = "dark" | "light";

/** Comment l'utilisateur se connecte aux modeles : par ses cles API, ou par
    un abonnement (Claude, ChatGPT, Google) qui donne acces a l'agent de
    l'editeur, pilote par ACP. Les deux peuvent coexister ; ce choix est
    l'onglet ouvert par defaut dans la page Authentification. */
export type AuthMode = "subscription" | "keys";

export type Settings = {
  version: 3;
  onboardingDone: boolean;
  theme: Theme;
  profile: Profile;
  authMode: AuthMode;
  keys: ApiKeys;
  /** Autant d'agents qu'on veut, chacun avec son fournisseur et son contexte.
      La colonne de gauche les liste ; les conversations sont rattachees a
      l'un d'eux. */
  agents: AgentConfig[];
  activeAgentId: string | null;
};

export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Le modele qui a produit la reponse (assistant seulement). */
  modelId?: string;
  /** L'effort demande pour cette reponse, s'il etait fixe. */
  effort?: string;
  /** Une reponse interrompue par une erreur garde ce qu'elle a recu, et
      l'erreur. */
  error?: string;
  /** Les pas d'une reponse d'assistant qui a utilise des outils : texte et
      appels, dans l'ordre. Absent pour une reponse en texte seul. */
  steps?: Step[];
  /** Ce qu'a coute la reponse : jetons, prix, fournisseur. */
  usage?: UsageInfo;
  /** Les fichiers et captures joints par l'utilisateur a ce message. */
  attachments?: Attachment[];
  /** Ce message demandait une recherche approfondie. */
  research?: boolean;
  /** Ce message est le RESUME qui a remplace un fil compacte (`/compact`) :
      le fil l'affiche comme tel, et l'historique le rejoue comme un rappel
      de contexte plutot que comme une reponse. */
  compaction?: boolean;
  /** Qui l'a declenchee : `user` (/compact), `auto` (jauge pleine en fin de
      tour), `overflow` (le fournisseur a refuse le contexte). Absent sur
      les fils anciens : vaut `user`. */
  compactedBy?: "user" | "auto" | "overflow";
  /** Le compactage EN COURS : le resume s'ecrit dans ce message, que le fil
      montre comme une ligne d'etat et jamais comme une reponse. Il est
      retire a la fin du tour (remplace par le resume, ou supprime). */
  compacting?: boolean;
};

export type Conversation = {
  id: string;
  agentId: string;
  title: string;
  modelId: string;
  /** L'effort de raisonnement demande, ou `null` pour laisser le modele a
      son reglage par defaut. */
  effort?: string | null;
  /** Le mode de l'agent externe pour cette conversation. */
  mode?: string | null;
  /** Pour un agent par abonnement : la session ACP qui porte cette
      conversation chez l'agent externe, a recharger apres un redemarrage. */
  acpSessionId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

/** Un modele du catalogue OpenRouter, reduit a ce dont l'interface a besoin. */
export type Model = {
  id: string;
  name: string;
  providerId: string;
  /** Date de sortie, en secondes Unix (telle que fournie par OpenRouter). */
  created: number;
  contextLength: number | null;
  /** Le suffixe apres `:` (`free`, `batch`, `thinking`…) : une declinaison
      d'un modele de base, pas un modele nouveau. */
  variant: string | null;
  /** Vrai pour les ids `~editeur/…-latest` : un alias mobile que OpenRouter
      fait pointer vers le dernier modele, pas une sortie. */
  alias: boolean;
  /** Les niveaux d'effort de raisonnement que le modele accepte, dans l'ordre
      publie par OpenRouter (`max`, `xhigh`, `high`, `medium`, `low`,
      `minimal`, `none`). Vide si le modele ne raisonne pas. */
  efforts: string[];
  defaultEffort: string | null;
  /** Vrai quand le modele raisonne toujours : on peut regler l'effort, pas
      le couper. */
  reasoningMandatory: boolean;
};

export type Provider = {
  id: string;
  name: string;
  modelCount: number;
};
