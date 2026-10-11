import type { Messages } from "../en";

export const scheduler: Messages["scheduler"] = {
  /* A frequency as the user reads it (`lib/plugins/shared/frequency-words.ts`,
     shared with the DCA tab). Mid-sentence: the screens put the first
     letter up when it starts a line. `weekday`: 0 is Sunday. */
  frequency: {
    everyMinute: "toutes les minutes",
    everyMinutes: (n: number) => `toutes les ${n} minutes`,
    everyHour: "toutes les heures",
    everyHours: (n: number) => `toutes les ${n} heures`,
    everyDay: "tous les jours",
    everyDays: (n: number) => `tous les ${n} jours`,
    dailyAt: (time: string) => `tous les jours à ${time}`,
    weeklyAt: (weekday: number, time: string) => `tous les ${["dimanches", "lundis", "mardis", "mercredis", "jeudis", "vendredis", "samedis"][weekday]} à ${time}`,
  },
  /* A moment against now (`relative` in `lib/plugins/scheduler/timeline.ts`).
     `day`: a short weekday name from Intl ("Mon"). */
  relative: {
    now: "maintenant",
    justNow: "à l’instant",
    inMinutes: (n: number) => `dans ${n} min`,
    inHours: (h: number, mm: string) => `dans ${h} h ${mm}`,
    todayAt: (time: string) => `aujourd’hui ${time}`,
    tomorrowAt: (time: string) => `demain ${time}`,
    weekdayAt: (day: string, time: string) => `${day} ${time}`,
    minutesAgo: (n: number) => `il y a ${n} min`,
    hoursAgo: (n: number) => `il y a ${n} h`,
    yesterdayAt: (time: string) => `hier ${time}`,
  },

  /* The tab (`view.tsx`). */
  title: "Tâches planifiées",
  readingSchedule: "Lecture du planning…",
  intro: "Un agent qui travaille seul, au rythme que vous choisissez — tant que BytNode-AI est ouvert dans un onglet.",
  summary: (active: number, paused: number, next: string | null) =>
    `${active} ${active <= 1 ? "active" : "actives"}${paused ? `, ${paused} en pause` : ""}${next ? ` — la prochaine ${next}` : ""}.`,
  running: (n: number) => `${n} en cours`,
  updated: (time: string) => `Mis à jour à ${time}`,
  readAgain: "Relire le planning",
  tasks: "Tâches",
  recentRuns: "Exécutions récentes",
  foot: "Les heures sont celles de cet ordinateur. Un agent planifié a les outils d’un sous-agent — il ne passe jamais d’ordre et ne déplace jamais de fonds — et chaque exécution utilise son modèle, ou son abonnement.",

  /* The next 24 hours (`timeline.tsx`). */
  timeline: {
    label: "Les prochaines 24 heures",
    title: "Prochaines 24 heures",
    now: "Maintenant",
    nothing: "Rien ne s’exécute dans les prochaines 24 heures.",
    runs: (title: string, every: string) => `${title} s’exécute ${every}.`,
  },

  /* The tasks and the runs (`lists.tsx`). */
  list: {
    failed: (when: string) => `échec ${when}`,
    ran: (when: string) => `exécutée ${when}`,
    running: "En cours",
    paused: "En pause",
    resume: (title: string) => `Reprendre ${title}`,
    pause: (title: string) => `Mettre en pause ${title}`,
    delete: (title: string) => `Supprimer ${title}`,
    lastFailed: (message: string) => `La dernière exécution a échoué : ${message}`,
    starting: "Démarrage…",
    runNow: "Exécuter maintenant",
    done: "Terminé.",
    failedRun: "Échec.",
    openReport: "Ouvrir le rapport comme une conversation",
    deleteRun: (title: string) => `Supprimer cette exécution de ${title}`,
    showFewer: "Afficher moins",
    showAll: (n: number) => `Afficher les ${n}`,
  },

  /* "New scheduled task" (`composer.tsx`). */
  composer: {
    everyFewHours: "Toutes les quelques heures",
    daily: "Chaque jour",
    weekly: "Chaque semaine",
    custom: "Personnalisé",
    everyHour: "Toutes les heures",
    hours: (n: string) => `${n} h`,
    hint: "every 30 minutes · every 4 hours · daily at 08:00 · every monday at 09:30",
    giveTitle: "Donnez un titre à la tâche.",
    sayWhat: "Dites ce que l’agent doit faire.",
    createAgent: "Créez d’abord un agent (Réglages → Agents).",
    unreadable: "Le planificateur ne sait pas lire cette fréquence.",
    tooOften: "Une tâche d’agent s’exécute au plus toutes les 15 minutes.",
    scheduledNow: (title: string) => `« ${title} » est planifiée — sa première exécution démarre maintenant.`,
    scheduled: (title: string, next: string) => `« ${title} » est planifiée — première exécution ${next}.`,
    newTask: "Nouvelle tâche planifiée",
    label: "Planifier une tâche",
    taskName: "Nom de la tâche",
    taskTitle: "Titre de la tâche",
    runBy: "Exécutée par",
    agent: "Agent",
    noAgent: "Créez d’abord un agent",
    whatToDo: "Ce que l’agent doit faire",
    promptPlaceholder: "Ce que l’agent doit faire, comme vous le lui demanderiez : « Résume les mouvements de la nuit sur ma liste de suivi, les taux de funding et les événements du jour. Sources et heures pour chaque chiffre. »",
    when: "Quand",
    frequency: "Fréquence",
    every: "Toutes les",
    day: "Jour",
    at: "À",
    customFrequency: "Fréquence personnalisée",
    notAFrequency: "Le planificateur ne sait pas lire cette fréquence",
    tooOftenShort: "Une tâche d’agent s’exécute au plus toutes les 15 minutes",
    firstRun: (next: string) => `Première exécution ${next}`,
    catchUp: "Rattraper une exécution manquée",
    catchUpLong: "Rattraper une exécution manquée pendant que l’application était fermée",
    scheduling: "Planification…",
    schedule: "Planifier",
  },

  /* Where a report is also sent (`telegram-pick.tsx`). */
  telegram: {
    fullReport: "Rapport complet",
    short: "Court",
    noBot: "Ajoutez un bot Telegram dans Réglages → Authentification pour y envoyer les rapports.",
    dontSend: "Ne pas envoyer",
    removedBot: "Bot supprimé",
    bot: "Bot Telegram",
    report: "Rapport",
  },
};
