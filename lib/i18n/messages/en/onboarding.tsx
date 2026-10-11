import type { ReactNode } from "react";

/* The first launch's setup (`components/onboarding/`), and its bricks the
   settings reuse: the subscriptions and keys, the agent's form, the
   exchange accounts, the Telegram bots; the first conversation's welcome
   (`lib/onboarding/first-run.ts`) and the professions' names. */
export const onboarding = {
  wizard: {
    dialog: "Set up BytNode-AI",
    stepsNav: "Steps",
    steps: { you: "You", ai: "Your AI", channels: "Telegram", exchanges: "Exchanges" },
    youTitle: "Set up your app",
    firstName: "What should I call you?",
    bio: "About you",
    bioHint: "Your activity, your habits: what every agent should know about you.",
    bioPlaceholder: "Independent crypto trader, I mostly work on BTC and ETH…",
    appearance: "Appearance",
    dark: "Dark",
    light: "Light",
    lastName: "Last name",
    email: "Email",
    aiTitle: "Connect your AI",
    aiChoices: "How your agents reach the models",
    subscriptionTitle: "A subscription I already have",
    subscriptionDesc: "Claude, ChatGPT, Copilot or Grok. Nothing extra to pay.",
    keyTitle: "An OpenRouter key",
    keyDesc: "Every model in one key, billed per use.",
    channelsTitle: "Stay in the loop",
    channelsLede: "Optional. Connect a Telegram bot to get alerts and reports on your phone, as they happen.",
    exchangesTitle: "Connect your exchanges",
    exchangesLede: "Optional. You can add or remove them any time in Settings.",
    skipAndStart: "Skip and start",
    /* The companion's lines, typed letter by letter: whole sentences. */
    say: {
      you: (firstName: string) =>
        `${firstName ? `Hi ${firstName}! ` : "Hi! "}I'm BytNode-AI, your market agent. Let's set things up together. First, tell me what to call you and a few words about you, so every agent knows who it works for.`,
      ai: "Now, let's choose what powers me. If you already pay for Claude, ChatGPT, Copilot or Grok, sign in and I'll run on that subscription. No subscription? An OpenRouter key works too.",
      channels: "Want me to reach you away from your computer? Connect a Telegram bot and I'll send you alerts and scheduled reports as they happen. You can skip this and add it later in Settings.",
      exchanges: (desktop: boolean) =>
        `Last thing: if you like, link your exchange accounts so I can follow your balances and trades. Your API keys stay on this computer${desktop ? ", locked in your system's vault" : ""}: nothing is sent to us or exposed online, and we never see your exchange data. I'll always ask you before an order.`,
    },
    errors: {
      firstName: "Tell me your first name to continue.",
      subscription: "Sign in to a subscription, or add an OpenRouter key, to continue.",
      bytnode: "Add your BytNode key to continue: without it, the agents have no market data.",
    },
  },

  agent: {
    newTitle: "A new agent",
    lede: "A name, a model provider, and what it should know before answering you. You will choose the exact model in each conversation.",
    name: "Name",
    access: "Access to the models",
    accessGroup: "Source of the models",
    bySubscription: "By subscription",
    bySubscriptionDesc: "Claude, OpenAI, GitHub Copilot, Grok: the vendor's agent, on your account, with no extra token.",
    byKey: "By OpenRouter key",
    byKeyDesc: "Every vendor in the OpenRouter catalog, with the BytNode-AI tools, billed per use on your key.",
    subscription: "Subscription",
    vendor: "Vendor",
    viaSubscription: (product: string) => `via ${product}, on your subscription`,
    viaKey: "Through your OpenRouter key",
    change: "Change",
    profession: "Profession",
    professionGroup: "Agent's profession",
    professionHint: (folder: ReactNode) => (
      <>
        The profession gives the agent its system prompt and its skills ({folder} folder). The context below is added to it.
      </>
    ),
    context: "Context",
    contextHint: "Its role, your activity, instructions. Passed on at the start of every conversation.",
    contextPlaceholder: "You are the assistant of …",
    files: "Reference files",
    workspace: "Workspace",
    workspaceHint: "Where the agent starts its commands and resolves relative paths. Empty: a ~/.bytnode-ai/workspaces/<id> folder.",
    scope: "Scope",
    scopeGroup: "Scope of the file tools",
    scopeWorkspace: "Workspace only",
    scopeWorkspaceDesc:
      "The file tools refuse any outside path, and a shell command that names one is refused before it runs (a guard on the command's text — combine with the conversation's ask-first mode for a real safety net).",
    scopeDisk: "Whole disk",
    scopeDiskDesc: "Any absolute path is accepted. The workspace is only the starting point.",
    exchanges: "Exchange accounts",
    noExchange: "Add an account in Settings → Auth so this agent can trade.",
    exchangesHint: "The accounts this agent can read and drive. None: no exchange tool.",
    testnet: "TESTNET",
    live: "LIVE",
  },

  /* What the agent's form shows of a profession; ids and what the agent
     reads stay in `lib/professions/catalog.ts`. */
  professions: {
    standard: {
      label: "Standard",
      short: "Generalist",
      description: "Solid across finance and crypto markets as a whole, with no speciality. The right first point of contact.",
    },
    analyste: {
      label: "Analyst",
      short: "Data & trends",
      description: "Reads market data and the macro context, derives trends and scenarios from them, with a confidence level.",
    },
    strategique: {
      label: "Strategist",
      short: "Strategies",
      description: "Designs complete strategies — objective, entry and exit rules, risk, test plan — crypto-focused, open to other markets.",
    },
    quantitatif: {
      label: "Quantitative",
      short: "Maths & code",
      description: "Mathematics, statistics and Python: models, backtests and implements algorithms with rigour.",
    },
  },

  auth: {
    reading: "Reading…",
    updating: (product: string) => `Updating ${product} to its latest version…`,
    installing: (product: string) => `Installing ${product}… (a few minutes)`,
    toInstall: (plan: string, product: string) => `${plan} · via ${product}, to install`,
    signedIn: (account: string, cli: boolean) => `Signed in${account ? ` · ${account}` : ""}${cli ? " · CLI detected" : ""}`,
    signInFailed: "The sign-in did not finish.",
    signingInCode: "Signing in — finish in your browser, then paste the code below.",
    signingInWindow: "Signing in — finish in the window that opened, then come back here.",
    plan: (plan: string, product: string, detected: boolean) => `${plan} · via ${product}${detected ? " (detected on this machine)" : ""}`,
    install: "Install",
    installingButton: "Installing",
    update: "Update",
    updatingButton: "Updating",
    signIn: "Sign in",
    signOut: "Sign out",
    waiting: "Waiting",
    subscriptionsHint:
      "Signing in opens the browser on the vendor's page (and, for GitHub Copilot, a terminal window). No key is created: your subscription is what gets used, with its usual limits. Missing agents install into ~/.bytnode-ai/agents on the first click; an agent already installed on the machine is recognised.",
    codeText: "Sign in to your account in the browser window that opened. When the page shows a code, copy it and paste it here.",
    browserDidNotOpen: "Browser did not open?",
    codePlaceholder: (product: string) => `The code ${product} shows`,
    codeLabel: (product: string) => `Sign-in code for ${product}`,
    checking: "Checking",
    continue: "Continue",
    openrouterLabel: "OpenRouter key",
    openrouterHint: "Starts with sk-or-. Gives access to every vendor, billed per use.",
    openrouterLink: "Get my OpenRouter key",
    bytnodeLabel: "BytNode key",
    bytnodeHint: "Starts with cb_. Required: without it, the agents have no market data.",
    bytnodeLink: "Create or copy my key in the BytNode console",
    dataTools: (n: number) => (n === 1 ? "1 data tool" : `${n} data tools`),
    keyRefused: "Key refused.",
    unreachable: "Could not reach the service.",
    recognised: (label: string) => (label ? `Key recognised: ${label}.` : "Key recognised."),
    showKey: "Show the key",
    hideKey: "Hide the key",
    verify: "Verify",
    verified: "Verified",
    /* The subscription each agent expects (`ACP_AGENTS[].plan`). */
    plans: {
      claude: "Claude Pro or Max",
      openai: "ChatGPT Plus, Pro or Business",
      copilot: "GitHub Copilot Pro, Pro+ or Business",
      grok: "SuperGrok or X Premium",
    },
  },

  picker: {
    via: (product: string) => `via ${product}`,
    viaAccount: (account: string, product: string) => `${account} · via ${product}`,
    installing: (product: string) => `Installing ${product}…`,
    signingIn: "Signing in — finish in your browser.",
    unavailable: "Unavailable on this installation.",
    searchVendor: "Search a vendor",
    readingCatalog: "Reading the OpenRouter catalog…",
    reload: "Reload",
    noVendor: (query: string) => `No vendor matches "${query}".`,
    models: (n: number) => (n === 1 ? "1 model" : `${n} models`),
  },

  files: {
    maxFiles: (n: number) => `${n} files at most.`,
    notText: (name: string) => `${name}: only text files are read.`,
    tooBig: (name: string, size: string) => `${name} exceeds ${size}.`,
    drop: (browse: ReactNode) => (
      <>
        <span>Drop text files here, or</span>
        {browse}
      </>
    ),
    browse: "browse",
    remove: (name: string) => `Remove ${name}`,
  },

  folder: {
    cannotOpen: "Could not open the file explorer.",
    cannotOpenWhy: (why: string) => `Could not open the file explorer: ${why}`,
    placeholder: "Full path of a folder",
    browseTitle: "Choose in the file explorer",
    browse: "Browse…",
  },

  /* Shared by the Telegram bots and the exchange accounts. */
  serverUnreachable: "Could not reach the server.",
  test: "Test",
  keep: "Keep",

  telegram: {
    title: "Telegram bots",
    hint: "A scheduled task's report or an alert can also be sent to Telegram: each task and each alert chooses its bot. Add as many as you like.",
    addBot: "+ Add a bot",
    noChat: "no chat yet",
    sent: "✓ Sent: look in Telegram",
    notSent: "Not sent.",
    tokenRefused: "Token refused.",
    whyToken: "Paste the bot's token from @BotFather.",
    whyCheck: "Check the token first.",
    whyStart: (username: string) => `Send /start to @${username} in Telegram: its chat is found by itself.`,
    whyDuplicate: "A bot already has this name: choose another.",
    step1: (botFather: ReactNode, newbot: ReactNode) => (
      <>
        In Telegram, open {botFather}, send {newbot} and choose a name: it gives you the bot&apos;s token.
      </>
    ),
    step2: "Paste the token here and check it.",
    step3: (start: ReactNode) => <>Open your bot in Telegram and send it {start}: its chat is found by itself.</>,
    nameLabel: "Name in BytNode-AI",
    nameHint: "How your tasks and alerts will call it.",
    duplicate: "A bot already has this name.",
    namePlaceholder: "Trading alerts",
    tokenLabel: "Bot token",
    tokenHint: "It looks like 123456789:AAH…",
    check: "Check",
    checked: "Checked",
    chatFound: (chat: string) => `✓ Chat found: ${chat}`,
    webhook: (username: string, host: string) =>
      `@${username} sends its messages to another service (a webhook, ${host}): Telegram does not give them to BytNode-AI. Create a new bot with @BotFather for BytNode-AI.`,
    openBot: (bot: ReactNode, start: ReactNode) => (
      <>
        Now open {bot} — your bot, not @BotFather — and send it {start}.
      </>
    ),
    lookAgain: "Look again",
    waiting: "Waiting for your /start…",
    anotherServer: "another server",
  },

  exchanges: {
    refused: "Account refused.",
    title: "Exchange accounts",
    hint: "Binance, Bybit, OKX… The agents you attach to them will be able to read balances, place orders and move funds between spot and futures — every order is submitted to you first.",
    addAccount: "Add an account",
    whyDuplicate: "An account already has this name: choose another.",
    whyKey: "Paste the API key.",
    whySecret: "Paste the secret.",
    whyPassphrase: (exchange: string) => `${exchange} also needs the API passphrase.`,
    exchange: "Exchange",
    exchangeList: "Exchanges",
    spotOnly: "spot only",
    futuresReadOnly: "futures read-only",
    spotAndFutures: "spot + futures",
    testnet: "testnet",
    passphrase: "passphrase",
    accountName: "Account name",
    accountNameHint: (name: string) => `The one the agent will use: "${name}".`,
    duplicate: "An account already has this name.",
    apiKey: "API key",
    secret: "Secret",
    passphraseLabel: "Passphrase",
    testnetCheck: (offered: boolean): string => (offered ? "Test network (testnet)" : "Test network (testnet) — not offered by this exchange"),
    /* What to know about each exchange, under its choice
       (`lib/tools/exchange/catalog.ts`, `note`). */
    notes: {
      binance: "Testnet: spot keys (testnet.binance.vision) and futures keys (testnet.binancefuture.com) are distinct — a testnet account serves only one of the two markets.",
      bybit: "Unified account: spot and futures share the same balance. Deposits land in the Funding wallet, to be transferred to the unified account before trading. Testnet: keys created on testnet.bybit.com.",
      okx: "Unified trading account: spot and futures share the same balance; deposits land in the Funding account, to be transferred to trading. Testnet = OKX demo, with API keys created in demo mode.",
      coinbase: "Advanced Trade, spot markets. CDP key: the secret is the EC private key (the \"-----BEGIN … -----\" block), to paste as is.",
      kraken: "Kraken Futures has its own keys (futures.kraken.com), outside this integration.",
      bitget: "Futures: the account must be in one-way mode (Bitget starts in hedge mode) — checked before every order.",
      kucoin: "A single key, with the Spot and Futures permissions, serves both markets. Deposits land on the main account, to be transferred to the trading account.",
      gate: "Testnet: keys created on testnet.gate.com. The margin mode cannot be set through the API (leverage only).",
      htx: "No spot ↔ USDT futures transfer nor margin mode through this integration: do it on the exchange.",
      mexc: "Futures read-only: MEXC closed futures order placement and cancellation by API (since 2022-07-25). Spot is complete.",
    },
  },

  /* The first conversation, written in the language chosen at the end of
     the setup. Markdown: the headings are set in bold by the code. */
  welcome: {
    title: "Welcome to BytNode-AI",
    hello: (name: string) => `${name ? `Hi ${name}` : "Hi"}, I'm your first agent. I work right here, on your computer, with the AI you just connected.`,
    canDoTitle: "What I can do for you",
    canDoMarket: "**Read the market live**: prices, order books, derivatives, on-chain and macro data from BytNode, across eleven exchanges.",
    canDoBuild: "**Analyse and build**: I write and run code, draw charts and backtest strategies, and keep my work in my own folder.",
    canDoAccounts: "**Follow your accounts**: once you link an exchange, I read your balances and positions, and I always ask before an order.",
    canDoAway: "**Work while you're away**: schedule a task, a morning brief or a weekly review, and its report lands in the sidebar.",
    yoursTitle: "Make me yours",
    yours: "Open my page in the sidebar to give me a profession, instructions and files. Create other agents for other jobs, each with its own model and folder.",
    tryTitle: "Try one of these",
    tryMoving: "What's moving in crypto right now?",
    tryChart: "Chart BTC on the 4-hour with the RSI, and tell me what you see.",
    tryBacktest: "Backtest a 20/50 moving-average cross on ETH over the last year.",
  },
};
