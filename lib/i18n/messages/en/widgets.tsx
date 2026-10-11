import type { ReactNode } from "react";

/* The widgets of the conversation page: their names, their menus, the
   gallery and what each one says (`components/chat/widgets/`). */
export const widgets = {
  /* One per widget kind (`lib/widgets/catalog.ts` keeps the English). */
  kinds: {
    watchlist: { name: "Watchlist", description: "Your assets, their price and their 24 h move." },
    portfolio: { name: "Portfolio", description: "Your total, its move and how it is split." },
    paper: { name: "Paper trading", description: "Your paper portfolio's value, return and open positions." },
    dca: { name: "DCA", description: "Your next purchases and what the plans have put in." },
    calendar: { name: "Calendar", description: "What comes next this week." },
    scheduler: { name: "Scheduled tasks", description: "Your agents' next runs and their last reports." },
    alerts: { name: "Alerts", description: "Your alerts, what they read now, the last that fired." },
    calculator: { name: "Position size", description: "Size a trade from your risk, entry and stop." },
  },
  sizes: { small: "Small", medium: "Medium", large: "Large" },
  /* The edit mode's size buttons: one letter each. */
  sizeLetters: { small: "S", medium: "M", large: "L" },

  /* The header's button and its menu. */
  title: "Widgets",
  addWidget: "Add a widget",
  editWidgets: "Edit widgets",
  doneEditing: "Done editing",
  hideWidgets: "Hide widgets",
  showWidgets: "Show widgets",
  showHidden: (n: number) => `Show hidden widgets (${n})`,

  /* A widget's edit buttons and its right-click menu. */
  removeNamed: (name: string) => `Remove the ${name} widget`,
  size: "Size",
  menuOf: (name: string) => `${name} widget`,
  hideWidget: "Hide widget",
  removeWidget: "Remove widget",

  /* The gallery. */
  nothingToAdd: "No widget to add: their plugins are off, or the widgets are switched off. See Settings → Plugins and Settings → Widgets.",
  add: "Add widget",
  sizeHint: "Small says the one thing that matters; medium adds the next few; large, the list.",
  preview: "Preview",

  /* What the widgets say. */
  watchlistEmpty: "Add assets in the Watchlist.",
  last24h: "24 h",
  last7d: "7 days",
  last30d: "30 days",
  readingAccounts: "Reading your accounts…",
  portfolioEmpty: "Connect an exchange account in Settings → Auth to see your portfolio here.",
  today: "today",
  over30d: (move: ReactNode) => <>{move} over 30 days</>,
  sinceStart: "since the start",
  noPaperPortfolio: "No paper portfolio yet.",
  noOpenPosition: "No open position.",
  long: "Long",
  short: "Short",
  spot: "Spot",
  noActivePlan: "No active plan.",
  nextPurchase: "Next purchase",
  invested: "Invested",
  return: "Return",
  nothingThisWeek: "Nothing this week.",
  moreThisWeek: (n: number) => `${n} more this week`,
  noScheduledTask: "No scheduled task.",
  runningNow: "Running now",
  nextRun: "Next run",
  running: "Running",
  lastReports: "Last reports",
  runDone: "Done",
  runFailed: "Failed",
  alertsWatching: (n: number): string => (n === 1 ? "alert watching" : "alerts watching"),
  fired: (symbol: string, when: string) => `${symbol} fired ${when}`,
  activeCount: (n: number) => `${n} active`,
  noActiveAlert: "No active alert.",
  lastFired: (symbol: ReactNode, when: string, observed: string) => (
    <>
      Last fired: {symbol} {when} · {observed}
    </>
  ),
  calculator: {
    capital: "Capital",
    risk: "Risk %",
    entry: "Entry",
    stop: "Stop",
    size: "Size",
    notional: "Notional",
    leverage: "Leverage",
    atRisk: "At risk",
  },
};
