import type { Messages } from "../en";

export const calendar: Messages["calendar"] = {
  /* Each calendar's name in full (an event's details, a filter's tooltip)
     and short (the filters, the new entry's themes). The agents read
     `CATEGORY_LABELS`, which stays in English. */
  categories: {
    macro: "宏观",
    unlock: "代币解锁",
    listing: "上币 / 下架",
    expiry: "期权与期货到期",
    upgrade: "升级 / 分叉",
    project: "项目",
    task: "任务",
    scheduled: "定时任务",
  },
  short: {
    macro: "宏观",
    unlock: "解锁",
    listing: "上币",
    expiry: "到期",
    upgrade: "升级",
    project: "项目",
    task: "任务",
    scheduled: "定时",
  },
  tomorrow: "明天",

  /* The month (`month.tsx`, `month-title.tsx`). */
  month: "月份",
  thisWeek: "本周",
  period: "时段",
  previousMonth: "上个月",
  nextMonth: "下个月",
  dayEvents: (day: string, n: number) => `${day}，${n} 个事件`,
  chooseMonth: "选择月份",
  chooseYear: "选择年份",
  months: "月份",
  years: "年份",
  earlierYears: "更早的年份",
  laterYears: "更晚的年份",

  /* The filters (`filters.tsx`). */
  calendars: "日历",
  marketMovingOnly: "仅显示重大事件",
  watchlistOnly: "仅显示我的自选列表",

  /* The agenda (`agenda.tsx`, `hours.tsx`, `week-grid.tsx`). */
  nothingToday: "当天没有安排",
  nextEvent: (when: string) => `下一个事件：${when}`,
  askAgent: "让你的某个智能体添加事件、任务或提醒。",
  newEventAt: (time: string) => `在 ${time} 新建事件`,
  newEventCell: (day: string, time: string) => `新建事件——${day} ${time}`,
  nowAt: (time: string) => `现在，${time}`,
  openDay: (day: string) => `打开 ${day}`,

  /* An event's details (`event-facts.tsx`). */
  facts: {
    computed: "根据交易平台的时间表计算",
    addedByYou: "由你添加",
    addedBy: (who: string) => `由 ${who} 添加`,
    calendar: "日历",
    done: " · 已完成",
    assets: "资产",
    impact: "影响",
    marketMoving: "重大事件",
    notes: "备注",
    source: "来源",
    addedByLabel: "添加者",
    openScheduler: "打开定时任务",
    deleteConfirm: "删除——再点一次",
  },

  /* The user's own entry (`new-entry.tsx`). */
  entry: {
    nameIt: "请为条目命名。",
    timeIt: "请为条目设置时间。",
    label: "新建事件",
    name: "名称",
    theme: "主题",
    description: "描述",
    time: "时间",
  },

  columnWidth: "月份栏宽度",
};
