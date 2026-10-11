import type { Messages } from "../en";

export const scheduler: Messages["scheduler"] = {
  /* A frequency as the user reads it (`lib/plugins/shared/frequency-words.ts`,
     shared with the DCA tab). Mid-sentence: the screens put the first
     letter up when it starts a line. `weekday`: 0 is Sunday. */
  frequency: {
    everyMinute: "cada minuto",
    everyMinutes: (n: number) => `cada ${n} minutos`,
    everyHour: "cada hora",
    everyHours: (n: number) => `cada ${n} horas`,
    everyDay: "cada día",
    everyDays: (n: number) => `cada ${n} días`,
    dailyAt: (time: string) => `cada día a las ${time}`,
    weeklyAt: (weekday: number, time: string) => `cada ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][weekday]} a las ${time}`,
  },
  /* A moment against now (`relative` in `lib/plugins/scheduler/timeline.ts`).
     `day`: a short weekday name from Intl ("Mon"). */
  relative: {
    now: "ahora",
    justNow: "hace un momento",
    inMinutes: (n: number) => `en ${n} min`,
    inHours: (h: number, mm: string) => `en ${h} h ${mm}`,
    todayAt: (time: string) => `hoy ${time}`,
    tomorrowAt: (time: string) => `mañana ${time}`,
    weekdayAt: (day: string, time: string) => `${day} ${time}`,
    minutesAgo: (n: number) => `hace ${n} min`,
    hoursAgo: (n: number) => `hace ${n} h`,
    yesterdayAt: (time: string) => `ayer ${time}`,
  },

  /* The tab (`view.tsx`). */
  title: "Tareas programadas",
  readingSchedule: "Leyendo la programación…",
  intro: "Un agente que trabaja por su cuenta, al ritmo que elijas, mientras BytNode-AI esté abierto en una pestaña.",
  summary: (active: number, paused: number, next: string | null) =>
    `${active} ${active === 1 ? "activa" : "activas"}${paused ? `, ${paused} en pausa` : ""}${next ? `; la próxima ${next}` : ""}.`,
  running: (n: number) => `${n} en curso`,
  updated: (time: string) => `Actualizado a las ${time}`,
  readAgain: "Volver a leer la programación",
  tasks: "Tareas",
  recentRuns: "Ejecuciones recientes",
  foot: "Las horas son las de este ordenador. Un agente programado tiene las herramientas de un subagente —nunca coloca órdenes ni mueve fondos— y cada ejecución usa su modelo o su suscripción.",

  /* The next 24 hours (`timeline.tsx`). */
  timeline: {
    label: "Las próximas 24 horas",
    title: "Próximas 24 horas",
    now: "Ahora",
    nothing: "No se ejecuta nada en las próximas 24 horas.",
    runs: (title: string, every: string) => `${title} se ejecuta ${every}.`,
  },

  /* The tasks and the runs (`lists.tsx`). */
  list: {
    failed: (when: string) => `falló ${when}`,
    ran: (when: string) => `se ejecutó ${when}`,
    running: "En curso",
    paused: "En pausa",
    resume: (title: string) => `Reanudar ${title}`,
    pause: (title: string) => `Pausar ${title}`,
    delete: (title: string) => `Eliminar ${title}`,
    lastFailed: (message: string) => `La última ejecución falló: ${message}`,
    starting: "Iniciando…",
    runNow: "Ejecutar ahora",
    done: "Hecho.",
    failedRun: "Falló.",
    openReport: "Abrir el informe como una conversación",
    deleteRun: (title: string) => `Eliminar esta ejecución de ${title}`,
    showFewer: "Mostrar menos",
    showAll: (n: number) => `Mostrar las ${n}`,
  },

  /* "New scheduled task" (`composer.tsx`). */
  composer: {
    everyFewHours: "Cada pocas horas",
    daily: "Diaria",
    weekly: "Semanal",
    custom: "Personalizada",
    everyHour: "Cada hora",
    hours: (n: string) => `${n} h`,
    hint: "every 30 minutes · every 4 hours · daily at 08:00 · every monday at 09:30",
    giveTitle: "Ponle un título a la tarea.",
    sayWhat: "Di qué debe hacer el agente.",
    createAgent: "Crea primero un agente (Ajustes → Agentes).",
    unreadable: "El programador no entiende esta frecuencia.",
    tooOften: "Una tarea de agente se ejecuta como máximo cada 15 minutos.",
    scheduledNow: (title: string) => `«${title}» está programada: su primera ejecución empieza ahora.`,
    scheduled: (title: string, next: string) => `«${title}» está programada: primera ejecución ${next}.`,
    newTask: "Nueva tarea programada",
    label: "Programar una tarea",
    taskName: "Nombre de la tarea",
    taskTitle: "Título de la tarea",
    runBy: "La ejecuta",
    agent: "Agente",
    noAgent: "Crea primero un agente",
    whatToDo: "Lo que debe hacer el agente",
    promptPlaceholder: "Lo que debe hacer el agente, como se lo pedirías: «Resume los movimientos de la noche en mi lista de seguimiento, las tasas de funding y los eventos del día. Fuentes y horas para cada cifra».",
    when: "Cuándo",
    frequency: "Frecuencia",
    every: "Cada",
    day: "Día",
    at: "A las",
    customFrequency: "Frecuencia personalizada",
    notAFrequency: "El programador no entiende esta frecuencia",
    tooOftenShort: "Una tarea de agente se ejecuta como máximo cada 15 minutos",
    firstRun: (next: string) => `Primera ejecución ${next}`,
    catchUp: "Recuperar una ejecución perdida",
    catchUpLong: "Recuperar una ejecución perdida mientras la app estaba cerrada",
    scheduling: "Programando…",
    schedule: "Programar",
  },

  /* Where a report is also sent (`telegram-pick.tsx`). */
  telegram: {
    fullReport: "Informe completo",
    short: "Breve",
    noBot: "Añade un bot de Telegram en Ajustes → Autenticación para enviar allí los informes.",
    dontSend: "No enviar",
    removedBot: "Bot eliminado",
    bot: "Bot de Telegram",
    report: "Informe",
  },
};
