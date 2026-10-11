import type { ReactNode } from "react";
import type { Messages } from "../en";

export const chat: Messages["chat"] = {
  /* The page and its header. */
  newConversation: "Nouvelle conversation",
  yourAgent: "Votre agent",
  unnamed: "Sans nom",
  agent: "Agent",
  agents: "Agents",
  conversations: "Conversations",
  showColumn: "Afficher la colonne",
  closeMenu: "Fermer le menu",
  exchangeAccounts: (list: string) => `Comptes d’exchange : ${list}`,
  foot: "L’agent peut se tromper. Vérifiez ce qui compte.",
  storageFull:
    "Le stockage du navigateur est plein : ce qui est affiché ne survivra pas à un rechargement. Supprimez d’anciennes conversations, ou compactez celle-ci (/compact).",
  compactFailed: (message: string) => `Échec du compactage : ${message}`,
  retry: "Réessayer",
  deleteAgentTitle: (name: string) => `Supprimer ${name} ?`,
  deleteAgentBody: (conversations: number) =>
    conversations === 0
      ? "L’agent et sa configuration seront supprimés. Cette action est irréversible."
      : conversations === 1
        ? "L’agent, sa configuration et sa conversation seront supprimés. Cette action est irréversible."
        : `L’agent, sa configuration et ses ${conversations} conversations seront supprimés. Cette action est irréversible.`,

  /* Our two permission modes, for an agent on OpenRouter. */
  modes: {
    ask: { name: "Demander avant d’agir", description: "Chaque commande et chaque modification de fichier attend votre autorisation." },
    skip: { name: "Exécution directe", description: "Chaque outil s’exécute sans demander." },
  },

  /* No access to the models: the composer's line and its way out. */
  locked: {
    noKey: "Pas encore de clé OpenRouter.",
    needsInstall: (agent: string) => `${agent} doit être réinstallé.`,
    notSignedIn: (agent: string) => `${agent} n’est pas connecté.`,
    addKey: "Ajouter une clé",
    install: (agent: string) => `Installer ${agent}`,
    signIn: (agent: string) => `Se connecter à ${agent}`,
  },

  /* The thread. */
  hello: (name: string) => `Bonjour, ${name}.`,
  helloAnon: "Bonjour.",
  listening: (agent: string) => `${agent} vous écoute.`,
  welcome: (name: string) => `Bienvenue, ${name}.`,
  welcomeAnon: "Bienvenue.",
  welcomeSub: "Votre premier agent est prêt. Voici ce que nous pouvons faire ensemble.",
  jumpToBottom: "Aller en bas",
  followReply: "Suivre la réponse",

  /* A message. */
  deepResearch: "Recherche approfondie",
  compacting: "Compactage de la conversation…",
  compactingHint: "l’agent résume l’essentiel, puis le résumé remplace la conversation",
  agentWriting: "L’agent écrit",
  agentWorking: "L’agent travaille",
  commandRan: (command: ReactNode) => <>{command} exécutée — rien à afficher.</>,
  stopped: "Arrêtée",
  continue: "Continuer",
  viewSummary: "voir le résumé",
  hideSummary: "masquer le résumé",
  plan: "Plan",
  compacted: "Conversation compactée",
  compactedAuto: "Conversation compactée automatiquement — fenêtre pleine",
  compactedOverflow: "Conversation compactée automatiquement — contexte dépassé",

  /* A tool call, a workflow's sub-agents, the permission prompt. */
  tool: {
    task: (n: number) => `Tâche ${n}`,
    hide: "masquer",
    follow: "suivre",
    viewReport: "voir le rapport",
    viewSteps: "voir les étapes",
    thinking: "Réflexion — aucun outil utilisé pour l’instant.",
    commitsFunds: "Cette action engage des fonds. Autorisez-la une fois, en connaissance de cause.",
    irreversible: "Cette commande est irréversible. Autorisez-la une fois, en connaissance de cause.",
    wantsTool: "L’agent veut utiliser cet outil.",
    allow: "Autoriser",
    deny: "Refuser",
    remembered: (rule: string) => `Cette autorisation sera retenue pour cet agent : ${rule}`,
    alwaysAllow: (tool: string) => `Toujours autoriser ${tool}`,
    alwaysAllowCommand: (command: string) => `Toujours autoriser « ${command} … »`,
  },

  /* The composer. */
  composer: {
    placeholder: "Écrivez votre message…  (/ pour les commandes)",
    placeholderLocked: "Connectez un accès aux modèles pour écrire.",
    reply: "Répondre…",
    howCanIHelp: "Comment puis-je vous aider ?",
    howCanIHelpToday: "Comment puis-je vous aider aujourd’hui ?",
    yourMessage: "Votre message",
    commands: "Commandes",
    keyChoose: "choisir",
    keyComplete: "compléter",
    keyRun: "exécuter",
    keyClose: "fermer",
    removeResearch: "Retirer la recherche approfondie",
    remove: (name: string) => `Retirer ${name}`,
    addTitle: "Ajouter des fichiers, une capture d’écran, une recherche approfondie",
    addToMessage: "Ajouter au message",
    addFiles: "Ajouter des fichiers",
    addFilesHint: "Déposés dans l’espace de travail de l’agent",
    screenshot: "Faire une capture d’écran",
    screenshotHint: "Vous choisissez l’écran ou la fenêtre",
    researchOn: "Activée pour le prochain message",
    researchHint: "Plusieurs sources, recoupées et datées",
    stopReply: "Arrêter la réponse",
    send: "Envoyer",
    sendTitle: "Envoyer (Entrée)",
    /* BytNode-AI's own commands, by name (an agent's own keep its words). */
    own: {
      compact: {
        args: "[instructions]",
        description: "Remplacer la conversation par un résumé : l’agent garde l’essentiel, la conversation s’allège",
      },
    },
  },

  /* The conversation's settings (the composer's chip). */
  picker: {
    settings: "Réglages",
    conversationSettings: "Réglages de la conversation",
    chipLabel: (model: string, effort: string | null) =>
      effort ? `Réglages de la conversation : ${model}, effort ${effort}` : `Réglages de la conversation : ${model}`,
    backToSettings: "Retour aux réglages",
    model: "Modèle",
    effort: "Effort",
    mode: "Mode",
    profession: "Métier",
    chooseModel: "Choisissez un modèle",
    doesNotReason: "Ne raisonne pas",
    default: "Par défaut",
    noReasoning: "Sans raisonnement",
    searchModelsOf: (agent: string) => `Rechercher parmi les modèles ${agent}`,
    searchAllModels: "Rechercher parmi tous les modèles",
    searchModel: "Rechercher un modèle",
    readingCatalog: "Lecture du catalogue…",
    readingSubscription: (agent: string) => `Lecture des modèles de votre abonnement ${agent}…`,
    reload: "Recharger",
    noMatch: (query: string) => `Aucun modèle ne correspond à « ${query} ».`,
    providerEmpty: "Ce fournisseur n’a aucun modèle.",
    yourSubscription: (agent: string) => `Votre abonnement ${agent}`,
    latestReleases: "Dernières sorties",
  },

  /* The effort levels, as named on screen. */
  efforts: {
    max: "Max",
    xhigh: "Très élevé",
    high: "Élevé",
    medium: "Moyen",
    low: "Faible",
    minimal: "Minimal",
    none: "Aucun",
  },

  /* The meter, bottom right. */
  usage: {
    context: (estimated: boolean, tokens: string, window: string | null) =>
      `Contexte ${estimated ? "estimé" : "mesuré"} : ${tokens} tokens${window ? ` sur ${window}` : ""}`,
    input: (tokens: string) => `Entrée : ${tokens}`,
    output: (tokens: string) => `Sortie : ${tokens}`,
    cost: (cost: string) => `Coût du tour : ${cost}`,
    provider: (provider: string) => `Fournisseur : ${provider}`,
    filling: "La fenêtre se remplit : /compact remplace la conversation par un résumé.",
  },

  /* The left column. */
  sidebar: {
    label: "Agents et conversations",
    collapse: "Replier la colonne",
    newAgent: "Nouvel agent",
    empty: "Créez un premier agent pour commencer.",
    you: "Vous",
    accountSettings: "Réglages du compte",
    scheduled: "Tâches planifiées",
    scheduledEmpty: "Les rapports de vos tâches planifiées arriveront ici, un dossier par tâche.",
    taskOf: (task: string, agent: string) => `${task} — tâche planifiée de ${agent}`,
    showLess: "Afficher moins",
    showAll: "Tout afficher",
    showAllCount: (n: number) => `Tout afficher (${n})`,
    hideConversationsOf: (agent: string) => `Masquer les conversations de ${agent}`,
    showConversationsOf: (agent: string) => `Afficher les conversations de ${agent}`,
    hideConversations: "Masquer les conversations",
    showConversations: "Afficher les conversations",
    optionsFor: (agent: string) => `Options de ${agent}`,
    optionsForConversation: (title: string) => `Options de « ${title} »`,
    editAgent: "Modifier l’agent",
    newTitle: "Nouveau titre",
    report: (title: string, agent: string | null) =>
      agent ? `${title} — rapport d’une tâche planifiée, par ${agent}` : `${title} — rapport d’une tâche planifiée`,
  },

  /* An agent's page. */
  page: {
    subscription: (agent: string) => `Abonnement ${agent}`,
    empty: (agent: string) => `Rien pour l’instant. Écrivez ci-dessus pour démarrer la première conversation avec ${agent}.`,
    about: "À propos de cet agent",
    recent: "Récentes",
    thisWeek: "Cette semaine",
    earlier: "Plus tôt",
    overview: "Aperçu",
    thisWeekCount: (n: number) => `${n} cette semaine`,
    noneThisWeek: "aucune cette semaine",
    lastActive: "Dernière activité",
    neverYet: "pas encore",
    messages: "Messages",
    inDays: (days: number) => ` sur ${days} jours`,
    options: "Options de l’agent",
    deleteAgent: "Supprimer l’agent",
    instructions: "Instructions",
    editInstructions: "Modifier les instructions",
    addInstructions: "Ajouter des instructions",
    instructionsPlaceholder: "Vous êtes l’assistant de … Répondez en …",
    instructionsEmpty:
      "Adaptez les réponses de cet agent : ce qu’il doit savoir, comment il doit répondre. Transmis au début de chaque conversation.",
    context: "Contexte",
    addReferenceFiles: "Ajouter des fichiers de référence",
    addFiles: "Ajouter des fichiers",
    dropHint:
      "Déposez ici des documents texte — notes, CSV, Markdown, code — que cet agent utilisera comme référence dans chaque conversation.",
  },

  /* The floating agent, over the plugins' tabs. */
  floating: {
    conversationWith: (agent: string) => `Conversation avec ${agent}`,
    switch: "Changer d’agent ou de conversation",
    empty: "Aucune conversation pour l’instant.",
    expand: "Ouvrir dans Conversations",
    closeConversationWith: (agent: string) => `Fermer la conversation avec ${agent}`,
    talkTo: (agent: string) => `Parler à ${agent}`,
    waiting: (agent: string) => `${agent} attend votre autorisation`,
    writing: (agent: string) => `${agent} écrit`,
  },

  /* What went wrong, as the thread (or the screen that asked) says it. */
  errors: {
    interrupted: "La réponse a été interrompue. Vérifiez votre connexion.",
    noSummary: "L’agent n’a produit aucun résumé.",
    withCompactHint: (why: string) => `${why} Tapez /compact pour résumer la conversation, ou ouvrez-en une nouvelle.`,
    contextFullStopped:
      "La fenêtre de contexte est pleine et le compactage de la conversation a été arrêté. Tapez /compact pour résumer la conversation, ou ouvrez-en une nouvelle.",
    contextFullFailed: (error: string | null) =>
      `La fenêtre de contexte est pleine et le compactage de la conversation a échoué : ${error ?? "l’agent n’a produit aucun résumé."} Tapez /compact pour résumer la conversation, ou ouvrez-en une nouvelle.`,
    exceededMidTask: "Fenêtre de contexte dépassée en cours de tâche : la conversation est compactée, puis la tâche reprend.",
    keyRefused: (message: string) => `Clé OpenRouter refusée (${message}) — vérifiez-la dans les réglages.`,
    providerAnswered: (status: number) => `Le fournisseur a répondu ${status}.`,
    serverAnswered: (status: number) => `Le serveur a répondu ${status}.`,
    uploadFailed: (status: number) => `Échec de l’envoi (${status}).`,
    catalogUnavailable: "Catalogue indisponible.",
    subscriptionStatusUnavailable: "État de l’abonnement indisponible.",
    couldNotSignIn: "Connexion impossible.",
    codeNotSent: "Le code n’a pas pu être envoyé.",
    couldNotInstall: "Installation impossible.",
    couldNotSignOut: "Déconnexion impossible.",
    captureUnsupported: "Ce navigateur ne peut pas capturer l’écran.",
    captureBlockedMac:
      "macOS a bloqué la capture : autorisez votre navigateur dans Réglages Système → Confidentialité et sécurité → Enregistrement de l’écran et de l’audio système, puis redémarrez le navigateur.",
    captureEmpty: "L’écran partagé n’a rien affiché.",
    imagePrepare: "Impossible de préparer l’image.",
    imageEncode: "Impossible d’encoder l’image.",
    retrying: (reason: string, attempt: number, of: number) => `${reason} — nouvelle tentative ${attempt}/${of}…`,
  },
};
