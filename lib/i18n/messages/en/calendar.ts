export const calendar = {
  /* Each calendar's name in full (an event's details, a filter's tooltip)
     and short (the filters, the new entry's themes). The agents read
     `CATEGORY_LABELS`, which stays in English. */
  categories: {
    macro: "Macro",
    unlock: "Token unlock",
    listing: "Listing / delisting",
    expiry: "Options & futures expiry",
    upgrade: "Upgrade / fork",
    project: "Project",
    task: "Task",
    scheduled: "Scheduled task",
  },
  short: {
    macro: "Macro",
    unlock: "Unlocks",
    listing: "Listings",
    expiry: "Expiries",
    upgrade: "Upgrades",
    project: "Projects",
    task: "Tasks",
    scheduled: "Scheduled",
  },
  tomorrow: "Tomorrow",

  /* The month (`month.tsx`, `month-title.tsx`). */
  month: "Month",
  thisWeek: "This week",
  period: "Period",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  dayEvents: (day: string, n: number) => `${day}, ${n === 1 ? "1 event" : `${n} events`}`,
  chooseMonth: "Choose the month",
  chooseYear: "Choose the year",
  months: "Months",
  years: "Years",
  earlierYears: "Earlier years",
  laterYears: "Later years",

  /* The filters (`filters.tsx`). */
  calendars: "Calendars",
  marketMovingOnly: "Market-moving only",
  watchlistOnly: "My watchlist only",

  /* The agenda (`agenda.tsx`, `hours.tsx`, `week-grid.tsx`). */
  nothingToday: "Nothing on this day",
  nextEvent: (when: string) => `Next event: ${when}`,
  askAgent: "Ask one of your agents to add an event, a task or a reminder.",
  newEventAt: (time: string) => `New event at ${time}`,
  newEventCell: (day: string, time: string) => `New event — ${day}, ${time}`,
  nowAt: (time: string) => `Now, ${time}`,
  openDay: (day: string) => `Open ${day}`,

  /* An event's details (`event-facts.tsx`). */
  facts: {
    computed: "Computed from the venue's schedule",
    addedByYou: "Added by you",
    addedBy: (who: string) => `Added by ${who}`,
    calendar: "Calendar",
    done: " · done",
    assets: "Assets",
    impact: "Impact",
    marketMoving: "Market-moving",
    notes: "Notes",
    source: "Source",
    addedByLabel: "Added by",
    openScheduler: "Open Scheduled tasks",
    deleteConfirm: "Delete — click again",
  },

  /* The user's own entry (`new-entry.tsx`). */
  entry: {
    nameIt: "Give the entry a name.",
    timeIt: "Give the entry a time.",
    label: "New event",
    name: "Name",
    theme: "Theme",
    description: "Description",
    time: "Time",
  },

  columnWidth: "Width of the month column",
};
