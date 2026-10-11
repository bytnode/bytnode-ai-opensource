import type { Messages } from "../en";

export const shell: Messages["shell"] = {
  conversations: "Conversations",
  conversationsDescription: "Vos agents et leurs conversations",
  openPages: "Pages ouvertes",
  closeTab: (title: string) => `Fermer ${title}`,
  asleep: "En veille en arrière-plan — se met à jour à votre retour.",

  openView: "Ouvrir une vue",
  views: "Vues",
  noViews: "Aucune vue pour l'instant : activez un plugin qui en a une, dans Réglages → Plugins.",
  viewHere: "Ici",
  viewOpen: "Ouverte",

  notifications: "Notifications",
  notificationsUnread: (n: number) => (n <= 1 ? `Notifications, ${n} non lue` : `Notifications, ${n} non lues`),
  closeNotifications: "Fermer les notifications",
  markAllRead: "Tout marquer comme lu",
  clear: "Effacer",
  allowDesktop: "Les afficher sur le bureau quand BytNode-AI est en arrière-plan",
  noNotifications: "Rien pour l'instant. Les alertes, les tâches planifiées et les achats à confirmer apparaîtront ici.",
  reviewAndConfirm: "Vérifier et confirmer",

  confirmation: {
    notFound: "Demande introuvable",
    notFoundBody: "Elle a déjà été tranchée, ou elle a expiré.",
    preparedBy: (plugin: string) => `Préparé par ${plugin}`,
    unknownAccount: "compte inconnu",
    commitsFunds: "Cette action engage des fonds. Autorisez-la une fois, en connaissance de cause.",
    accountGone: "Le compte de cet ordre n'est plus configuré dans ce navigateur : il ne peut pas être exécuté.",
    later: "Plus tard",
    deny: "Refuser",
    allow: "Autoriser",
    allowed: "Fait.",
    denied: "Refusé.",
    expired: "Expiré.",
    failed: "Échec.",
  },

  reviewPlugin: "Examiner le plugin",
};
