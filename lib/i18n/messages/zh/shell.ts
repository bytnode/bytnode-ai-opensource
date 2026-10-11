import type { Messages } from "../en";

export const shell: Messages["shell"] = {
  conversations: "对话",
  conversationsDescription: "你的智能体及其对话",
  openPages: "已打开的页面",
  closeTab: (title: string) => `关闭“${title}”`,
  asleep: "在后台休眠——你回来时会自动更新。",

  openView: "打开视图",
  views: "视图",
  noViews: "还没有视图：请在“设置 → 插件”中启用带视图的插件。",
  viewHere: "当前",
  viewOpen: "已打开",

  notifications: "通知",
  notificationsUnread: (n: number) => `通知，${n} 条未读`,
  closeNotifications: "关闭通知",
  markAllRead: "全部标为已读",
  clear: "清空",
  allowDesktop: "BytNode-AI 在后台时，在桌面上显示通知",
  noNotifications: "暂无通知。提醒、定时任务和待确认的买入会显示在这里。",
  reviewAndConfirm: "查看并确认",

  confirmation: {
    notFound: "未找到该请求",
    notFoundBody: "它已被处理，或已过期。",
    preparedBy: (plugin: string) => `由 ${plugin} 准备`,
    unknownAccount: "未知账户",
    commitsFunds: "此操作会动用资金。请在知情的前提下仅允许这一次。",
    accountGone: "此订单对应的账户已不再配置于本浏览器中，无法执行。",
    later: "稍后",
    deny: "拒绝",
    allow: "允许",
    allowed: "已完成。",
    denied: "已拒绝。",
    expired: "已过期。",
    failed: "失败。",
  },

  reviewPlugin: "审查插件",
};
