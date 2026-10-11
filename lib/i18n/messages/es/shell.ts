import type { Messages } from "../en";

export const shell: Messages["shell"] = {
  conversations: "Conversaciones",
  conversationsDescription: "Tus agentes y sus conversaciones",
  openPages: "Páginas abiertas",
  closeTab: (title: string) => `Cerrar ${title}`,
  asleep: "En reposo en segundo plano: se pone al día cuando vuelves.",

  openView: "Abrir una vista",
  views: "Vistas",
  noViews: "Aún no hay vistas: activa un plugin que tenga una, en Ajustes → Plugins.",
  viewHere: "Aquí",
  viewOpen: "Abierta",

  notifications: "Notificaciones",
  notificationsUnread: (n: number) => (n === 1 ? "Notificaciones, 1 sin leer" : `Notificaciones, ${n} sin leer`),
  closeNotifications: "Cerrar las notificaciones",
  markAllRead: "Marcar todo como leído",
  clear: "Borrar",
  allowDesktop: "Mostrarlas en el escritorio cuando BytNode-AI esté en segundo plano",
  noNotifications: "Nada por ahora. Aquí aparecerán las alertas, las tareas programadas y las compras por confirmar.",
  reviewAndConfirm: "Revisar y confirmar",

  confirmation: {
    notFound: "Solicitud no encontrada",
    notFoundBody: "Ya se decidió o ha caducado.",
    preparedBy: (plugin: string) => `Preparado por ${plugin}`,
    unknownAccount: "cuenta desconocida",
    commitsFunds: "Esta acción compromete fondos. Permítela una vez, con conocimiento de causa.",
    accountGone: "La cuenta de esta orden ya no está configurada en este navegador: no se puede ejecutar.",
    later: "Más tarde",
    deny: "Denegar",
    allow: "Permitir",
    allowed: "Hecho.",
    denied: "Denegado.",
    expired: "Caducado.",
    failed: "Falló.",
  },

  reviewPlugin: "Revisar el plugin",
};
