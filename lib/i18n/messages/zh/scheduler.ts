import type { Messages } from "../en";

export const scheduler: Messages["scheduler"] = {
  /* A frequency as the user reads it (`lib/plugins/shared/frequency-words.ts`,
     shared with the DCA tab). Mid-sentence: the screens put the first
     letter up when it starts a line. `weekday`: 0 is Sunday. */
  frequency: {
    everyMinute: "每分钟",
    everyMinutes: (n: number) => `每 ${n} 分钟`,
    everyHour: "每小时",
    everyHours: (n: number) => `每 ${n} 小时`,
    everyDay: "每天",
    everyDays: (n: number) => `每 ${n} 天`,
    dailyAt: (time: string) => `每天 ${time}`,
    weeklyAt: (weekday: number, time: string) => `每周${["日", "一", "二", "三", "四", "五", "六"][weekday]} ${time}`,
  },
  /* A moment against now (`relative` in `lib/plugins/scheduler/timeline.ts`).
     `day`: a short weekday name from Intl ("Mon"). */
  relative: {
    now: "现在",
    justNow: "刚刚",
    inMinutes: (n: number) => `${n} 分钟后`,
    inHours: (h: number, mm: string) => `${h} 小时 ${mm} 分后`,
    todayAt: (time: string) => `今天 ${time}`,
    tomorrowAt: (time: string) => `明天 ${time}`,
    weekdayAt: (day: string, time: string) => `${day} ${time}`,
    minutesAgo: (n: number) => `${n} 分钟前`,
    hoursAgo: (n: number) => `${n} 小时前`,
    yesterdayAt: (time: string) => `昨天 ${time}`,
  },

  /* The tab (`view.tsx`). */
  title: "定时任务",
  readingSchedule: "正在读取计划…",
  intro: "一个按你选择的节奏自主工作的智能体——只要 BytNode-AI 在某个标签页中打开。",
  summary: (active: number, paused: number, next: string | null) => `${active} 个运行中${paused ? `，${paused} 个已暂停` : ""}${next ? `——下一个：${next}` : ""}。`,
  running: (n: number) => `${n} 个正在运行`,
  updated: (time: string) => `更新于 ${time}`,
  readAgain: "重新读取计划",
  tasks: "任务",
  recentRuns: "最近运行",
  foot: "时间以本机为准。定时智能体拥有子智能体的工具——从不下单或转移资金——每次运行都会使用它的模型或订阅。",

  /* The next 24 hours (`timeline.tsx`). */
  timeline: {
    label: "未来 24 小时",
    title: "未来 24 小时",
    now: "现在",
    nothing: "未来 24 小时内没有任务运行。",
    runs: (title: string, every: string) => `${title} ${every}运行一次。`,
  },

  /* The tasks and the runs (`lists.tsx`). */
  list: {
    failed: (when: string) => `运行失败（${when}）`,
    ran: (when: string) => `已运行（${when}）`,
    running: "正在运行",
    paused: "已暂停",
    resume: (title: string) => `恢复 ${title}`,
    pause: (title: string) => `暂停 ${title}`,
    delete: (title: string) => `删除 ${title}`,
    lastFailed: (message: string) => `上次运行失败：${message}`,
    starting: "正在启动…",
    runNow: "立即运行",
    done: "已完成。",
    failedRun: "失败。",
    openReport: "以对话形式打开报告",
    deleteRun: (title: string) => `删除 ${title} 的这次运行`,
    showFewer: "收起",
    showAll: (n: number) => `显示全部 ${n} 条`,
  },

  /* "New scheduled task" (`composer.tsx`). */
  composer: {
    everyFewHours: "每隔几小时",
    daily: "每天",
    weekly: "每周",
    custom: "自定义",
    everyHour: "每小时",
    hours: (n: string) => `${n} 小时`,
    hint: "every 30 minutes · every 4 hours · daily at 08:00 · every monday at 09:30",
    giveTitle: "请为任务填写标题。",
    sayWhat: "请说明智能体需要做什么。",
    createAgent: "请先创建一个智能体（设置 → 智能体）。",
    unreadable: "调度器无法识别此频率。",
    tooOften: "智能体任务最多每 15 分钟运行一次。",
    scheduledNow: (title: string) => `“${title}”已计划——首次运行现在开始。`,
    scheduled: (title: string, next: string) => `“${title}”已计划——首次运行：${next}。`,
    newTask: "新建定时任务",
    label: "计划一个任务",
    taskName: "任务名称",
    taskTitle: "任务标题",
    runBy: "执行者",
    agent: "智能体",
    noAgent: "请先创建一个智能体",
    whatToDo: "智能体需要做什么",
    promptPlaceholder: "像平时提问那样写下智能体要做的事：“总结我的自选列表隔夜的走势、资金费率和当天的事件。每个数字都注明来源和时间。”",
    when: "时间",
    frequency: "频率",
    every: "每隔",
    day: "星期",
    at: "时间",
    customFrequency: "自定义频率",
    notAFrequency: "调度器无法识别此频率",
    tooOftenShort: "智能体任务最多每 15 分钟运行一次",
    firstRun: (next: string) => `首次运行：${next}`,
    catchUp: "补跑错过的运行",
    catchUpLong: "补跑应用关闭期间错过的运行",
    scheduling: "正在计划…",
    schedule: "计划",
  },

  /* Where a report is also sent (`telegram-pick.tsx`). */
  telegram: {
    fullReport: "完整报告",
    short: "摘要",
    noBot: "在 设置 → 认证 中添加 Telegram 机器人，即可把报告发送到那里。",
    dontSend: "不发送",
    removedBot: "已删除的机器人",
    bot: "Telegram 机器人",
    report: "报告",
  },
};
