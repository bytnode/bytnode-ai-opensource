import type { Messages } from "../en";

export const calendar: Messages["calendar"] = {
  /* Each calendar's name in full (an event's details, a filter's tooltip)
     and short (the filters, the new entry's themes). The agents read
     `CATEGORY_LABELS`, which stays in English. */
  categories: {
    macro: "Macro",
    unlock: "Desbloqueo de tokens",
    listing: "Listado / exclusión",
    expiry: "Vencimiento de opciones y futuros",
    upgrade: "Actualización / fork",
    project: "Proyecto",
    task: "Tarea",
    scheduled: "Tarea programada",
  },
  short: {
    macro: "Macro",
    unlock: "Desbloqueos",
    listing: "Listados",
    expiry: "Vencimientos",
    upgrade: "Actualizaciones",
    project: "Proyectos",
    task: "Tareas",
    scheduled: "Programadas",
  },
  tomorrow: "Mañana",

  /* The month (`month.tsx`, `month-title.tsx`). */
  month: "Mes",
  thisWeek: "Esta semana",
  period: "Periodo",
  previousMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  dayEvents: (day: string, n: number) => `${day}, ${n === 1 ? "1 evento" : `${n} eventos`}`,
  chooseMonth: "Elegir el mes",
  chooseYear: "Elegir el año",
  months: "Meses",
  years: "Años",
  earlierYears: "Años anteriores",
  laterYears: "Años siguientes",

  /* The filters (`filters.tsx`). */
  calendars: "Calendarios",
  marketMovingOnly: "Solo los que mueven el mercado",
  watchlistOnly: "Solo mi lista de seguimiento",

  /* The agenda (`agenda.tsx`, `hours.tsx`, `week-grid.tsx`). */
  nothingToday: "Nada este día",
  nextEvent: (when: string) => `Próximo evento: ${when}`,
  askAgent: "Pide a uno de tus agentes que añada un evento, una tarea o un recordatorio.",
  newEventAt: (time: string) => `Nuevo evento a las ${time}`,
  newEventCell: (day: string, time: string) => `Nuevo evento — ${day}, ${time}`,
  nowAt: (time: string) => `Ahora, ${time}`,
  openDay: (day: string) => `Abrir ${day}`,

  /* An event's details (`event-facts.tsx`). */
  facts: {
    computed: "Calculado según el calendario de la plataforma",
    addedByYou: "Añadido por ti",
    addedBy: (who: string) => `Añadido por ${who}`,
    calendar: "Calendario",
    done: " · hecho",
    assets: "Activos",
    impact: "Impacto",
    marketMoving: "Mueve el mercado",
    notes: "Notas",
    source: "Fuente",
    addedByLabel: "Añadido por",
    openScheduler: "Abrir Tareas programadas",
    deleteConfirm: "Eliminar: haz clic otra vez",
  },

  /* The user's own entry (`new-entry.tsx`). */
  entry: {
    nameIt: "Ponle un nombre a la entrada.",
    timeIt: "Ponle una hora a la entrada.",
    label: "Nuevo evento",
    name: "Nombre",
    theme: "Tema",
    description: "Descripción",
    time: "Hora",
  },

  columnWidth: "Ancho de la columna del mes",
};
