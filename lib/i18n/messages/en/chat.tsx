import type { ReactNode } from "react";

export const chat = {
  /* The page and its header. */
  newConversation: "New conversation",
  yourAgent: "Your agent",
  unnamed: "Unnamed",
  agent: "Agent",
  agents: "Agents",
  conversations: "Conversations",
  showColumn: "Show the column",
  closeMenu: "Close the menu",
  exchangeAccounts: (list: string) => `Exchange accounts: ${list}`,
  foot: "The agent can make mistakes. Check what matters.",
  storageFull:
    "The browser storage is full: what is displayed will not survive a reload. Delete old conversations, or compact this one (/compact).",
  compactFailed: (message: string) => `Compaction failed: ${message}`,
  retry: "Retry",
  deleteAgentTitle: (name: string) => `Delete ${name}?`,
  deleteAgentBody: (conversations: number) =>
    conversations === 0
      ? "The agent and its configuration will be deleted. This cannot be undone."
      : conversations === 1
        ? "The agent, its configuration and its conversation will be deleted. This cannot be undone."
        : `The agent, its configuration and its ${conversations} conversations will be deleted. This cannot be undone.`,

  /* Our two permission modes, for an agent on OpenRouter. */
  modes: {
    ask: { name: "Ask before acting", description: "Every command and every file change waits for your permission." },
    skip: { name: "Direct execution", description: "Every tool runs without asking." },
  },

  /* No access to the models: the composer's line and its way out. */
  locked: {
    noKey: "No OpenRouter key yet.",
    needsInstall: (agent: string) => `${agent} needs installing again.`,
    notSignedIn: (agent: string) => `${agent} isn't signed in.`,
    addKey: "Add a key",
    install: (agent: string) => `Install ${agent}`,
    signIn: (agent: string) => `Sign in to ${agent}`,
  },

  /* The thread. */
  hello: (name: string) => `Hello, ${name}.`,
  helloAnon: "Hello.",
  listening: (agent: string) => `${agent} is listening.`,
  welcome: (name: string) => `Welcome, ${name}.`,
  welcomeAnon: "Welcome.",
  welcomeSub: "Your first agent is ready. Here is what we can do together.",
  jumpToBottom: "Jump to bottom",
  followReply: "Follow the reply",

  /* A message. */
  deepResearch: "Deep research",
  compacting: "Compacting the thread…",
  compactingHint: "the agent summarises what matters, then the summary replaces the conversation",
  agentWriting: "The agent is writing",
  agentWorking: "The agent is working",
  commandRan: (command: ReactNode) => <>{command} ran — nothing to show.</>,
  stopped: "Stopped",
  continue: "Continue",
  viewSummary: "view the summary",
  hideSummary: "hide the summary",
  plan: "Plan",
  compacted: "Conversation compacted",
  compactedAuto: "Conversation compacted automatically — window full",
  compactedOverflow: "Conversation compacted automatically — context exceeded",

  /* A tool call, a workflow's sub-agents, the permission prompt. */
  tool: {
    task: (n: number) => `Task ${n}`,
    hide: "hide",
    follow: "follow",
    viewReport: "view the report",
    viewSteps: "view the steps",
    thinking: "Thinking — no tool used yet.",
    commitsFunds: "This action commits funds. Allow it once, knowingly.",
    irreversible: "This command is irreversible. Allow it once, knowingly.",
    wantsTool: "The agent wants to run this tool.",
    allow: "Allow",
    deny: "Deny",
    remembered: (rule: string) => `This permission will be remembered for this agent: ${rule}`,
    alwaysAllow: (tool: string) => `Always allow ${tool}`,
    alwaysAllowCommand: (command: string) => `Always allow "${command} …"`,
  },

  /* The composer. */
  composer: {
    placeholder: "Write your message…  (/ for commands)",
    placeholderLocked: "Connect an access to the models to write.",
    reply: "Reply…",
    howCanIHelp: "How can I help?",
    howCanIHelpToday: "How can I help today?",
    yourMessage: "Your message",
    commands: "Commands",
    keyChoose: "choose",
    keyComplete: "complete",
    keyRun: "run",
    keyClose: "close",
    removeResearch: "Remove deep research",
    remove: (name: string) => `Remove ${name}`,
    addTitle: "Add files, a screenshot, deep research",
    addToMessage: "Add to the message",
    addFiles: "Add files",
    addFilesHint: "Dropped into the agent's workspace",
    screenshot: "Take a screenshot",
    screenshotHint: "You choose the screen or the window",
    researchOn: "On for the next message",
    researchHint: "Several sources, cross-checked and dated",
    stopReply: "Stop the reply",
    send: "Send",
    sendTitle: "Send (Enter)",
    /* BytNode-AI's own commands, by name (an agent's own keep its words). */
    own: {
      compact: {
        args: "[instructions]",
        description: "Replace the thread with a summary: the agent keeps what matters, the conversation gets lighter",
      },
    },
  },

  /* The conversation's settings (the composer's chip). */
  picker: {
    settings: "Settings",
    conversationSettings: "Conversation settings",
    chipLabel: (model: string, effort: string | null) =>
      effort ? `Conversation settings: ${model}, effort ${effort}` : `Conversation settings: ${model}`,
    backToSettings: "Back to the settings",
    model: "Model",
    effort: "Effort",
    mode: "Mode",
    profession: "Profession",
    chooseModel: "Choose a model",
    doesNotReason: "Does not reason",
    default: "Default",
    noReasoning: "No reasoning",
    searchModelsOf: (agent: string) => `Search ${agent} models`,
    searchAllModels: "Search all models",
    searchModel: "Search a model",
    readingCatalog: "Reading the catalog…",
    readingSubscription: (agent: string) => `Reading the models of your ${agent} subscription…`,
    reload: "Reload",
    noMatch: (query: string) => `No model matches "${query}".`,
    providerEmpty: "This provider has no model.",
    yourSubscription: (agent: string) => `Your ${agent} subscription`,
    latestReleases: "Latest releases",
  },

  /* The effort levels, as named on screen. */
  efforts: {
    max: "Max",
    xhigh: "Very high",
    high: "High",
    medium: "Medium",
    low: "Low",
    minimal: "Minimal",
    none: "None",
  },

  /* The meter, bottom right. */
  usage: {
    context: (estimated: boolean, tokens: string, window: string | null) =>
      `Context ${estimated ? "estimated" : "measured"}: ${tokens} tokens${window ? ` of ${window}` : ""}`,
    input: (tokens: string) => `Input: ${tokens}`,
    output: (tokens: string) => `Output: ${tokens}`,
    cost: (cost: string) => `Turn cost: ${cost}`,
    provider: (provider: string) => `Provider: ${provider}`,
    filling: "The window is filling up: /compact replaces the thread with a summary.",
  },

  /* The left column. */
  sidebar: {
    label: "Agents and conversations",
    collapse: "Collapse the column",
    newAgent: "New agent",
    empty: "Create a first agent to get started.",
    you: "You",
    accountSettings: "Account settings",
    scheduled: "Scheduled tasks",
    scheduledEmpty: "The reports of your scheduled tasks will land here, one folder per task.",
    taskOf: (task: string, agent: string) => `${task} — scheduled task of ${agent}`,
    showLess: "Show less",
    showAll: "Show all",
    showAllCount: (n: number) => `Show all (${n})`,
    hideConversationsOf: (agent: string) => `Hide the conversations of ${agent}`,
    showConversationsOf: (agent: string) => `Show the conversations of ${agent}`,
    hideConversations: "Hide the conversations",
    showConversations: "Show the conversations",
    optionsFor: (agent: string) => `Options for ${agent}`,
    optionsForConversation: (title: string) => `Options for "${title}"`,
    editAgent: "Edit the agent",
    newTitle: "New title",
    report: (title: string, agent: string | null) =>
      agent ? `${title} — report of a scheduled task, by ${agent}` : `${title} — report of a scheduled task`,
  },

  /* An agent's page. */
  page: {
    subscription: (agent: string) => `${agent} subscription`,
    empty: (agent: string) => `Nothing yet. Write above to start the first conversation with ${agent}.`,
    about: "About this agent",
    recent: "Recent",
    thisWeek: "This week",
    earlier: "Earlier",
    overview: "Overview",
    thisWeekCount: (n: number) => `${n} this week`,
    noneThisWeek: "none this week",
    lastActive: "Last active",
    neverYet: "never yet",
    messages: "Messages",
    inDays: (days: number) => ` in ${days} days`,
    options: "Agent options",
    deleteAgent: "Delete the agent",
    instructions: "Instructions",
    editInstructions: "Edit the instructions",
    addInstructions: "Add instructions",
    instructionsPlaceholder: "You are the assistant of … Answer in …",
    instructionsEmpty: "Tailor this agent's replies: what it should know, how it should answer. Passed at the start of every conversation.",
    context: "Context",
    addReferenceFiles: "Add reference files",
    addFiles: "Add files",
    dropHint: "Drop text documents here — notes, CSV, Markdown, code — for this agent to use as reference in every conversation.",
  },

  /* The floating agent, over the plugins' tabs. */
  floating: {
    conversationWith: (agent: string) => `Conversation with ${agent}`,
    switch: "Switch agent or conversation",
    empty: "No conversation yet.",
    expand: "Open in Conversations",
    closeConversationWith: (agent: string) => `Close the conversation with ${agent}`,
    talkTo: (agent: string) => `Talk to ${agent}`,
    waiting: (agent: string) => `${agent} is waiting for your permission`,
    writing: (agent: string) => `${agent} is writing`,
  },

  /* What went wrong, as the thread (or the screen that asked) says it. */
  errors: {
    interrupted: "The reply was interrupted. Check your connection.",
    noSummary: "The agent produced no summary.",
    withCompactHint: (why: string) => `${why} Type /compact to summarise the thread, or open a new conversation.`,
    contextFullStopped:
      "The context window is full and compacting the thread was stopped. Type /compact to summarise the thread, or open a new conversation.",
    contextFullFailed: (error: string | null) =>
      `The context window is full and compacting the thread failed: ${error ?? "the agent produced no summary."} Type /compact to summarise the thread, or open a new conversation.`,
    exceededMidTask: "Context window exceeded mid-task: the thread is compacted, then the task resumes.",
    keyRefused: (message: string) => `OpenRouter key refused (${message}) — check it in the settings.`,
    providerAnswered: (status: number) => `The provider answered ${status}.`,
    serverAnswered: (status: number) => `The server answered ${status}.`,
    uploadFailed: (status: number) => `Upload failed (${status}).`,
    catalogUnavailable: "Catalog unavailable.",
    subscriptionStatusUnavailable: "Subscription status unavailable.",
    couldNotSignIn: "Could not sign in.",
    codeNotSent: "The code could not be sent.",
    couldNotInstall: "Could not install.",
    couldNotSignOut: "Could not sign out.",
    captureUnsupported: "This browser cannot capture the screen.",
    captureBlockedMac:
      "macOS blocked the capture: allow your browser in System Settings → Privacy & Security → Screen & System Audio Recording, then restart the browser.",
    captureEmpty: "The shared screen rendered nothing.",
    imagePrepare: "Could not prepare the image.",
    imageEncode: "Could not encode the image.",
    retrying: (reason: string, attempt: number, of: number) => `${reason} — retrying ${attempt}/${of}…`,
  },
};
