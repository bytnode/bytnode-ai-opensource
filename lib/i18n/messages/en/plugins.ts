export const plugins = {
  /* The shipped plugins' manifests, as the USER reads them (the library,
     the tabs, the settings). `forAgents` is not here: the agent reads
     English. A plugin absent from here (one an agent wrote) shows its own
     words — `lib/i18n/plugin-text.ts`. */
  manifests: {
    "position-calc": {
      name: "Position calculator",
      summary: "Size, liquidation price and risk/reward before a trade",
      description: "Reliable figures before any order. How much to buy for the risk you accept, where a leveraged position would be liquidated, and what each target pays for what the stop risks — fees included. The agent runs these before it proposes an order; you can ask for them directly too. The liquidation price is an estimate: exchanges use tiered margin tables, and the assumptions are always shown.",
      data: null,
      views: {},
      config: {
        feePercent: { title: "Fees per side (%)", description: "Used when the agent gives none: your exchange's taker fee, in percent (0.06 = 0.06 %)." },
      },
    },
    "finance-tools": {
      name: "Charts and backtests",
      summary: "Market data to CSV, charts, the standard backtest engine",
      description: "The agent's quantitative workbench. SaveMarketData writes a BytNode series straight to a CSV in the workspace — thousands of candles without going through the conversation. Chart draws it as a PNG (candles, volume, indicators, markers, levels) that you see in the thread. Backtest runs a strategy the agent writes in a few lines through BytNode-AI's standard engine: next-candle execution, fees, slippage, funding, sizing by risk, in and out of sample, with the equity curve. The backtest needs Python 3 with pandas and numpy.",
      data: null,
      views: {},
      config: {},
    },
    watchlist: {
      name: "Watchlist",
      summary: "The assets you follow, known to your agents",
      description: "One list of the assets you follow, shared by all your agents: \"how is my watchlist doing this morning?\" works without saying which. Each asset shows its price and its 24 h and 7 d changes, from BytNode (or from your exchange for a pair BytNode does not cover). The agents see the symbols in their prompt, and can add or remove one when you ask. Alerts and the calendar use it as their default filter.",
      data: "Your followed assets: symbol, note, tags, date added.",
      views: {
        watchlist: { title: "Watchlist", description: "Your assets, their price and their 24 h / 7 d change." },
      },
      config: {},
    },
    "report-export": {
      name: "Report export",
      summary: "An analysis, its charts and its dated sources as a standalone document",
      description: "Turns an analysis made in a conversation into a document you keep or share: a single HTML file (or Markdown) in the agent's workspace, under reports/, with the title, the summary, the sections, the charts embedded, the table of sources — each with the date it was read — the date of generation and the notice \"information, not investment advice\". It opens without the app, loads nothing from the internet, and prints to PDF from any browser. The portfolio and the paper trading use it for their \"Export\" button.",
      data: null,
      views: {},
      config: {},
    },
    "paper-trading": {
      name: "Paper trading",
      summary: "Trade with simulated money, never real funds",
      description: "A simulated portfolio to try a strategy, move from a backtest toward real trading without risk, or discover the app without giving an exchange key. Orders take the same shape as real ones — market or limit, spot or futures with leverage — and fill at the current BytNode price (or your exchange's), with the fees and slippage you set; a limit waits until the market reaches it. Every paper order carries a PAPER badge in the thread, and the agents always say that a paper result is simulated, never a real performance.",
      data: "The simulated portfolio: its paper balances, positions, orders and fills.",
      views: {
        "paper-trading": { title: "Paper trading", description: "Simulated balances, positions, orders, result and history." },
      },
      config: {
        capital: { title: "Starting capital (USDT)", description: "The paper cash of a new or reset portfolio." },
        feePercent: { title: "Fee per fill (%)", description: "Charged on every fill, like an exchange's taker fee." },
        slippagePercent: { title: "Slippage (%)", description: "How much worse than the current price a market order fills." },
      },
    },
    scheduler: {
      name: "Scheduled tasks",
      summary: "Agents that work on their own, on a schedule",
      description: "Ask an agent for \"a market brief every morning at 8\" and it runs by itself at that time; its report arrives as a conversation, with a notification. The other plugins' own background work (the alerts' checks, the portfolio's daily snapshot, the recurring purchases) does not depend on this plugin: it runs whether this one is on or off, and is not listed here. Your tasks' coming runs show in the calendar. Everything runs only while BytNode-AI is open in a tab (the keys never leave your browser for the disk); a run missed while it was closed is skipped, or run once when it opens, as you choose per task. A scheduled agent gets the tools of a sub-agent: it can never place an order or move funds.",
      data: "Your scheduled tasks, the state of each job, and the last 500 runs with the agents' reports.",
      views: {
        scheduler: { title: "Scheduled tasks", description: "Your agent tasks, their next runs, and what they produced." },
      },
      config: {},
    },
    calendar: {
      name: "Calendar",
      summary: "Market events and your tasks, written by your agents",
      description: "A local calendar your agents read in an instant and write when you ask: \"add the next FOMC and CPI dates\", \"remind me Friday to review my BTC position\". They add market events — central-bank decisions and macro figures, token unlocks, listings, upgrades, project events — each with the page that announces it (an event without a source is rejected), and your own tasks, reminders and deadlines; they change or remove them, and tick tasks off. A scheduled task can fill it too. Options and futures expiries (Deribit, CME) are computed from the venues' schedules, and your scheduled tasks' coming runs are shown. The most important events and your tasks of the next 48 hours are in your agents' prompt.",
      data: "The entries your agents wrote (date, title, assets, importance, source, notes, the agent that wrote it). Expiries and scheduled runs are computed, not stored.",
      views: {
        calendar: { title: "Calendar", description: "Your calendar: market events, your tasks and your scheduled tasks, by day or week, filtered by calendar, importance and your watchlist." },
      },
      config: {},
    },
    alerts: {
      name: "Alerts",
      summary: "Be told when the market does what you are waiting for",
      description: "\"Tell me if BTC goes above 70 000\", \"if the RSI 14 of ETH on the hour drops under 30\", \"when the 50-day EMA of SOL crosses its 200-day\", \"if the funding of ETH passes 0.05 %\", \"the day before an important event on my watchlist\", \"if my position gets within 3 % of liquidation\": an alert watches the price, its change, the funding, any indicator (RSI, EMA, SMA, MACD, Bollinger, stochastic, ATR, volume — your length, your timeframe) against a level or another indicator, and fires in the notification center — and on your desktop if you allowed it — without a conversation open. On one asset or on your whole watchlist, once or every time. One notification per crossing, never one per check, with a cooldown between two; an alert that cannot be checked (no price for the asset) says so instead of staying silent. Checked every minute while the app is open.",
      data: "Your alerts (asset, condition, state) and the last 500 times one fired.",
      views: {
        alerts: { title: "Alerts", description: "Your alerts, their state, and what fired lately." },
      },
      config: {
        every: { title: "Check the alerts", description: "`every 1 minute`, `every 5 minutes`…" },
        cooldownMinutes: { title: "Quiet time after an alert fires (minutes)", description: "A recurring alert does not fire again sooner." },
      },
    },
    dca: {
      name: "Recurring purchases (DCA)",
      summary: "Buy a fixed amount at regular intervals — simulated or real, always confirmed",
      description: "\"Buy 100 USDT of BTC every Monday\": a plan buys the same amount at each due date. In the paper portfolio, the purchases happen by themselves. On an exchange account, each due date PROPOSES the purchase in the notification center — the same confirmation as in a conversation, with the LIVE or TESTNET badge — and nothing is bought without your click. Before proposing, the plan checks the market is open, the amount is above the exchange's minimum and the balance is enough; a failure is said, never retried in a loop. A due date missed while the app was closed is proposed when it opens, never bought by itself. Each plan keeps its history: total invested, quantity, average price. Plans can be gathered in groups (a project: \"Long term\", \"Altcoins\").",
      data: "Your plans (asset, amount, frequency, destination) and the history of their purchases.",
      views: {
        dca: { title: "DCA", description: "Your recurring purchases, alone or gathered in groups: value, average price, next due dates, history." },
      },
      config: {},
    },
    portfolio: {
      name: "Portfolio",
      summary: "One view of all your exchange accounts",
      description: "\"How much do I have, and how did it do?\" across every exchange account you allowed: balances of all wallets (spot, futures, funding), valued in the currency you choose, split by asset and by account, with the open positions. Testnet accounts are shown apart and never added to the total; an asset without a price is listed, never valued at zero in silence; an account that cannot be read is flagged without blocking the others. A daily snapshot of the total (while the app is open) draws the evolution. Values come from BytNode, or from your exchange when BytNode does not cover an asset.",
      data: "One snapshot a day: the date, the total, the split by asset and each live account's total (under its internal id) in USD — no key, no account name. The groups of accounts you make: a name and the accounts' internal ids.",
      views: {
        portfolio: { title: "Portfolio", description: "Total value, evolution, split by asset and by account, open positions." },
      },
      config: {
        currency: { title: "Reference currency", description: "Totals are shown in it; rates from Kraken's public market." },
        snapshotAt: { title: "Daily snapshot at", description: "Local time. Taken while the app is open; a missed one is taken when it opens." },
      },
    },
  },
  categories: {
    market: "Market",
    portfolio: "Portfolio and trading",
    automation: "Automation",
    tools: "Tools",
  },
  /* A prerequisite in the settings (`NEED_LABELS`, `lib/domain/plugins.ts`). */
  needs: {
    "exchange-account": "Exchange account required",
    "bytnode-key": "BytNode key required",
  },

  /* The pieces every view shares (`components/plugins/`). */
  evolution: "Evolution",
  viewOpened: (title: string) => `${title} opened`,
  resizeHint: "Drag to resize — double-click to reset",
  refresh: "Refresh",
  reloadData: "Reload the data",
  viewUnavailable: "This view is not available.",
  report: {
    export: "Export as a report",
    exporting: "Exporting…",
    /** Followed by the document's path, a link. */
    written: (agent: string) => `Report written in ${agent}'s workspace:`,
  },
  /* The tab of a plugin an agent wrote. */
  userView: {
    error: (problem: string) => `This page ran into an error: ${problem}`,
    agentSees: "Its agent sees it at its next check.",
    reload: "Reload",
  },
  /* The user's consent to a plugin an agent wrote (`plugin-consent.tsx`). */
  consent: {
    gone: "This plugin no longer exists.",
    changed: (name: string) => `${name}: its agent changed it since.`,
    newerBelow: "The newer version waits for you further down the conversation.",
    active: (name: string) => `${name} is active`,
    notActivated: (name: string) => `${name} was not activated`,
    refused: "Refused, or changed by its agent since. The agent can ask again.",
    openTab: "Open its tab",
    anAgent: "An agent",
    groupLabel: (name: string) => `Activate ${name}`,
    askUpdate: (name: string) => `Update the plugin ${name}?`,
    askActivate: (name: string) => `Activate the plugin ${name}?`,
    writtenBy: (agent: string, summary: string) => `Written by ${agent} · ${summary}`,
    itMay: "It may",
    reachesNothing: "Reach nothing outside itself: no internet, no account, no notification.",
    isNew: "New",
    adds: (items: string[]) => `It adds ${items.join(", ")}.`,
    toolAsks: (tool: string) => `${tool} (asks you first)`,
    tab: (title: string) => `the tab ${title}`,
    whichMoney: "On which money?",
    noAccount: "No exchange account is configured: add one in Settings → Auth first, or refuse.",
    testOrLive: "Testnet or live",
    test: "Test",
    testHint: "Fake money, nothing real is read or risked.",
    noTestnet: "No testnet account configured.",
    real: "Real",
    realHint: "Your real account.",
    noLive: "No live account configured.",
    warnOrders: "It will read your real account and may propose real-money orders. Each order still waits for your click, with its LIVE badge: it can never place one by itself. It never sees your keys.",
    warnRead: "It will read your real account: balances, positions, orders, trade history. It can place no order. It never sees your keys.",
    update: "Update",
    activate: "Activate",
    allowLive: "Allow on my real account",
    allowTestnet: "Allow on testnet",
    chooseMode: "Choose Test or Real",
    refuse: "Refuse",
  },
  /* What a plugin an agent wrote may reach, one line each
     (`describePermissions`, `lib/plugins/user/permissions.ts`). */
  permissions: {
    network: (hosts: string[]) => `Call ${hosts.join(", ")} on the internet`,
    bytnode: "Read BytNode's market data with your key (it never sees the key)",
    exchangeRead: "Read the exchange accounts you choose (test or real): balances, positions, orders, history — never your keys",
    exchangeOrders: "Read the exchange accounts you choose (test or real), and propose orders — each one waits for your confirmation",
    schedule: "Run on a schedule while BytNode-AI is open",
    notify: "Send you notifications",
  },
};
