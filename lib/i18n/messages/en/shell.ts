/* The app's frame: the tab bar, its previews, the "+" menu, the
   notification center and the prompts it opens (`components/shell/`). */
export const shell = {
  /* The first tab, always there. */
  conversations: "Conversations",
  conversationsDescription: "Your agents and their conversations",
  openPages: "Open pages",
  closeTab: (title: string) => `Close ${title}`,
  asleep: "Asleep in the background — it catches up when you come back.",

  /* The "+" menu. */
  openView: "Open a view",
  views: "Views",
  noViews: "No view yet: switch on a plugin that has one, in Settings → Plugins.",
  /* The tag of a view already open: in front, or behind. */
  viewHere: "Here",
  viewOpen: "Open",

  /* The notification center. */
  notifications: "Notifications",
  notificationsUnread: (n: number) => `Notifications, ${n} unread`,
  closeNotifications: "Close the notifications",
  markAllRead: "Mark all read",
  clear: "Clear",
  allowDesktop: "Show them on the desktop when BytNode-AI is in the background",
  noNotifications: "Nothing yet. Alerts, scheduled tasks and purchases to confirm will appear here.",
  reviewAndConfirm: "Review and confirm",

  /* A plugin's parked order. */
  confirmation: {
    notFound: "Request not found",
    notFoundBody: "It was already decided, or it expired.",
    preparedBy: (plugin: string) => `Prepared by ${plugin}`,
    unknownAccount: "unknown account",
    commitsFunds: "This action commits funds. Allow it once, knowingly.",
    accountGone: "The account of this order is no longer configured in this browser: it cannot run.",
    later: "Later",
    deny: "Deny",
    allow: "Allow",
    allowed: "Done.",
    denied: "Refused.",
    expired: "Expired.",
    failed: "Failed.",
  },

  /* A plugin written by an agent, reviewed in a window. */
  reviewPlugin: "Review the plugin",
};
