import type { Messages } from "../en";

export const calendar: Messages["calendar"] = {
  /* Each calendar's name in full (an event's details, a filter's tooltip)
     and short (the filters, the new entry's themes). The agents read
     `CATEGORY_LABELS`, which stays in English. */
  categories: {
    macro: "Macro",
    unlock: "Déblocage de tokens",
    listing: "Listing / retrait de la cote",
    expiry: "Échéance d’options et de futures",
    upgrade: "Mise à jour / fork",
    project: "Projet",
    task: "Tâche",
    scheduled: "Tâche planifiée",
  },
  short: {
    macro: "Macro",
    unlock: "Déblocages",
    listing: "Listings",
    expiry: "Échéances",
    upgrade: "Mises à jour",
    project: "Projets",
    task: "Tâches",
    scheduled: "Planifiées",
  },
  tomorrow: "Demain",

  /* The month (`month.tsx`, `month-title.tsx`). */
  month: "Mois",
  thisWeek: "Cette semaine",
  period: "Période",
  previousMonth: "Mois précédent",
  nextMonth: "Mois suivant",
  dayEvents: (day: string, n: number) => `${day}, ${n <= 1 ? `${n} événement` : `${n} événements`}`,
  chooseMonth: "Choisir le mois",
  chooseYear: "Choisir l’année",
  months: "Mois",
  years: "Années",
  earlierYears: "Années précédentes",
  laterYears: "Années suivantes",

  /* The filters (`filters.tsx`). */
  calendars: "Calendriers",
  marketMovingOnly: "Événements majeurs seulement",
  watchlistOnly: "Ma liste de suivi seulement",

  /* The agenda (`agenda.tsx`, `hours.tsx`, `week-grid.tsx`). */
  nothingToday: "Rien ce jour-là",
  nextEvent: (when: string) => `Prochain événement : ${when}`,
  askAgent: "Demandez à l’un de vos agents d’ajouter un événement, une tâche ou un rappel.",
  newEventAt: (time: string) => `Nouvel événement à ${time}`,
  newEventCell: (day: string, time: string) => `Nouvel événement — ${day}, ${time}`,
  nowAt: (time: string) => `Maintenant, ${time}`,
  openDay: (day: string) => `Ouvrir ${day}`,

  /* An event's details (`event-facts.tsx`). */
  facts: {
    computed: "Calculé d’après le calendrier de la plateforme",
    addedByYou: "Ajouté par vous",
    addedBy: (who: string) => `Ajouté par ${who}`,
    calendar: "Calendrier",
    done: " · fait",
    assets: "Actifs",
    impact: "Impact",
    marketMoving: "Événement majeur",
    notes: "Notes",
    source: "Source",
    addedByLabel: "Ajouté par",
    openScheduler: "Ouvrir les tâches planifiées",
    deleteConfirm: "Supprimer — cliquez à nouveau",
  },

  /* The user's own entry (`new-entry.tsx`). */
  entry: {
    nameIt: "Donnez un nom à l’entrée.",
    timeIt: "Donnez une heure à l’entrée.",
    label: "Nouvel événement",
    name: "Nom",
    theme: "Thème",
    description: "Description",
    time: "Heure",
  },

  columnWidth: "Largeur de la colonne du mois",
};
