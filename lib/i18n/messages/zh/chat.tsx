import type { ReactNode } from "react";
import type { Messages } from "../en";

export const chat: Messages["chat"] = {
  /* The page and its header. */
  newConversation: "新对话",
  yourAgent: "你的智能体",
  unnamed: "未命名",
  agent: "智能体",
  agents: "智能体",
  conversations: "对话",
  showColumn: "显示侧栏",
  closeMenu: "关闭菜单",
  exchangeAccounts: (list: string) => `交易所账户：${list}`,
  foot: "智能体可能会出错，重要信息请自行核实。",
  storageFull: "浏览器存储空间已满：当前显示的内容在重新加载后将无法保留。请删除旧对话，或压缩当前对话（/compact）。",
  compactFailed: (message: string) => `压缩失败：${message}`,
  retry: "重试",
  deleteAgentTitle: (name: string) => `删除 ${name}？`,
  deleteAgentBody: (conversations: number) =>
    conversations === 0
      ? "该智能体及其配置将被删除，此操作无法撤销。"
      : `该智能体、其配置及其 ${conversations} 个对话将被删除，此操作无法撤销。`,

  /* Our two permission modes, for an agent on OpenRouter. */
  modes: {
    ask: { name: "操作前询问", description: "每条命令和每次文件修改都需等待你的许可。" },
    skip: { name: "直接执行", description: "所有工具无需询问直接运行。" },
  },

  /* No access to the models: the composer's line and its way out. */
  locked: {
    noKey: "尚未添加 OpenRouter 密钥。",
    needsInstall: (agent: string) => `${agent} 需要重新安装。`,
    notSignedIn: (agent: string) => `${agent} 尚未登录。`,
    addKey: "添加密钥",
    install: (agent: string) => `安装 ${agent}`,
    signIn: (agent: string) => `登录 ${agent}`,
  },

  /* The thread. */
  hello: (name: string) => `你好，${name}。`,
  helloAnon: "你好。",
  listening: (agent: string) => `${agent} 正在倾听。`,
  welcome: (name: string) => `欢迎，${name}。`,
  welcomeAnon: "欢迎。",
  welcomeSub: "你的第一个智能体已就绪。来看看我们可以一起做些什么。",
  jumpToBottom: "跳到底部",
  followReply: "跟随回复",

  /* A message. */
  deepResearch: "深度研究",
  compacting: "正在压缩对话…",
  compactingHint: "智能体会总结要点，然后用摘要替换整个对话",
  agentWriting: "智能体正在输入",
  agentWorking: "智能体正在工作",
  commandRan: (command: ReactNode) => <>{command} 已执行，没有可显示的内容。</>,
  stopped: "已停止",
  continue: "继续",
  viewSummary: "查看摘要",
  hideSummary: "隐藏摘要",
  plan: "计划",
  compacted: "对话已压缩",
  compactedAuto: "对话已自动压缩：窗口已满",
  compactedOverflow: "对话已自动压缩：超出上下文",

  /* A tool call, a workflow's sub-agents, the permission prompt. */
  tool: {
    task: (n: number) => `任务 ${n}`,
    hide: "收起",
    follow: "跟随",
    viewReport: "查看报告",
    viewSteps: "查看步骤",
    thinking: "思考中，尚未使用任何工具。",
    commitsFunds: "此操作会动用资金。请在知情的前提下仅允许这一次。",
    irreversible: "此命令不可撤销。请在知情的前提下仅允许这一次。",
    wantsTool: "智能体想要运行此工具。",
    allow: "允许",
    deny: "拒绝",
    remembered: (rule: string) => `此授权将为该智能体保留：${rule}`,
    alwaysAllow: (tool: string) => `始终允许 ${tool}`,
    alwaysAllowCommand: (command: string) => `始终允许“${command} …”`,
  },

  /* The composer. */
  composer: {
    placeholder: "输入消息…  （输入 / 查看命令）",
    placeholderLocked: "请先连接模型访问方式，才能输入。",
    reply: "回复…",
    howCanIHelp: "有什么可以帮你？",
    howCanIHelpToday: "今天有什么可以帮你？",
    yourMessage: "你的消息",
    commands: "命令",
    keyChoose: "选择",
    keyComplete: "补全",
    keyRun: "运行",
    keyClose: "关闭",
    removeResearch: "移除深度研究",
    remove: (name: string) => `移除 ${name}`,
    addTitle: "添加文件、截图或深度研究",
    addToMessage: "添加到消息",
    addFiles: "添加文件",
    addFilesHint: "放入智能体的工作区",
    screenshot: "截图",
    screenshotHint: "由你选择屏幕或窗口",
    researchOn: "已为下一条消息开启",
    researchHint: "多个来源，交叉核实并标注日期",
    stopReply: "停止回复",
    send: "发送",
    sendTitle: "发送（Enter）",
    /* BytNode-AI's own commands, by name (an agent's own keep its words). */
    own: {
      compact: {
        args: "[说明]",
        description: "用摘要替换对话：智能体保留要点，对话变得更轻量",
      },
    },
  },

  /* The conversation's settings (the composer's chip). */
  picker: {
    settings: "设置",
    conversationSettings: "对话设置",
    chipLabel: (model: string, effort: string | null) => (effort ? `对话设置：${model}，推理强度 ${effort}` : `对话设置：${model}`),
    backToSettings: "返回设置",
    model: "模型",
    effort: "推理强度",
    mode: "模式",
    profession: "职业",
    chooseModel: "请选择模型",
    doesNotReason: "不支持推理",
    default: "默认",
    noReasoning: "不推理",
    searchModelsOf: (agent: string) => `搜索 ${agent} 模型`,
    searchAllModels: "搜索全部模型",
    searchModel: "搜索模型",
    readingCatalog: "正在读取模型目录…",
    readingSubscription: (agent: string) => `正在读取你的 ${agent} 订阅中的模型…`,
    reload: "重新加载",
    noMatch: (query: string) => `没有与“${query}”匹配的模型。`,
    providerEmpty: "该提供商没有任何模型。",
    yourSubscription: (agent: string) => `你的 ${agent} 订阅`,
    latestReleases: "最新发布",
  },

  /* The effort levels, as named on screen. */
  efforts: {
    max: "最高",
    xhigh: "很高",
    high: "高",
    medium: "中",
    low: "低",
    minimal: "极低",
    none: "无",
  },

  /* The meter, bottom right. */
  usage: {
    context: (estimated: boolean, tokens: string, window: string | null) =>
      `${estimated ? "估算" : "实测"}上下文：${tokens} tokens${window ? ` / ${window}` : ""}`,
    input: (tokens: string) => `输入：${tokens}`,
    output: (tokens: string) => `输出：${tokens}`,
    cost: (cost: string) => `本轮费用：${cost}`,
    provider: (provider: string) => `提供商：${provider}`,
    filling: "上下文窗口即将用满：/compact 会用摘要替换对话。",
  },

  /* The left column. */
  sidebar: {
    label: "智能体与对话",
    collapse: "收起侧栏",
    newAgent: "新建智能体",
    empty: "创建第一个智能体即可开始。",
    you: "你",
    accountSettings: "账户设置",
    scheduled: "定时任务",
    scheduledEmpty: "定时任务的报告会出现在这里，每个任务一个文件夹。",
    taskOf: (task: string, agent: string) => `${task}：${agent} 的定时任务`,
    showLess: "收起",
    showAll: "查看全部",
    showAllCount: (n: number) => `查看全部（${n}）`,
    hideConversationsOf: (agent: string) => `隐藏 ${agent} 的对话`,
    showConversationsOf: (agent: string) => `显示 ${agent} 的对话`,
    hideConversations: "隐藏对话",
    showConversations: "显示对话",
    optionsFor: (agent: string) => `${agent} 的选项`,
    optionsForConversation: (title: string) => `“${title}”的选项`,
    editAgent: "编辑智能体",
    newTitle: "新标题",
    report: (title: string, agent: string | null) => (agent ? `${title}：${agent} 的定时任务报告` : `${title}：定时任务报告`),
  },

  /* An agent's page. */
  page: {
    subscription: (agent: string) => `${agent} 订阅`,
    empty: (agent: string) => `暂无对话。在上方输入，即可开始与 ${agent} 的第一次对话。`,
    about: "关于此智能体",
    recent: "最近",
    thisWeek: "本周",
    earlier: "更早",
    overview: "概览",
    thisWeekCount: (n: number) => `本周 ${n} 个`,
    noneThisWeek: "本周暂无",
    lastActive: "最近活动",
    neverYet: "尚无",
    messages: "消息",
    inDays: (days: number) => ` 条 · 近 ${days} 天`,
    options: "智能体选项",
    deleteAgent: "删除智能体",
    instructions: "指令",
    editInstructions: "编辑指令",
    addInstructions: "添加指令",
    instructionsPlaceholder: "你是……的助手。请用……回答。",
    instructionsEmpty: "定制这个智能体的回复：它应该了解什么、应该如何回答。每次对话开始时都会传给它。",
    context: "上下文",
    addReferenceFiles: "添加参考文件",
    addFiles: "添加文件",
    dropHint: "将文本文档拖放到这里（笔记、CSV、Markdown、代码），该智能体会在每次对话中将其作为参考。",
  },

  /* The floating agent, over the plugins' tabs. */
  floating: {
    conversationWith: (agent: string) => `与 ${agent} 的对话`,
    switch: "切换智能体或对话",
    empty: "暂无对话。",
    expand: "在“对话”中打开",
    closeConversationWith: (agent: string) => `关闭与 ${agent} 的对话`,
    talkTo: (agent: string) => `与 ${agent} 对话`,
    waiting: (agent: string) => `${agent} 正在等待你的许可`,
    writing: (agent: string) => `${agent} 正在输入`,
  },

  /* What went wrong, as the thread (or the screen that asked) says it. */
  errors: {
    interrupted: "回复已中断，请检查网络连接。",
    noSummary: "智能体没有生成摘要。",
    withCompactHint: (why: string) => `${why}输入 /compact 来总结对话，或开启一个新对话。`,
    contextFullStopped: "上下文窗口已满，对话压缩已被停止。输入 /compact 来总结对话，或开启一个新对话。",
    contextFullFailed: (error: string | null) =>
      `上下文窗口已满，对话压缩失败：${error ?? "智能体没有生成摘要。"}输入 /compact 来总结对话，或开启一个新对话。`,
    exceededMidTask: "任务进行中超出了上下文窗口：对话将被压缩，随后任务继续。",
    keyRefused: (message: string) => `OpenRouter 密钥被拒绝（${message}），请在设置中检查。`,
    providerAnswered: (status: number) => `提供商返回了 ${status}。`,
    serverAnswered: (status: number) => `服务器返回了 ${status}。`,
    uploadFailed: (status: number) => `上传失败（${status}）。`,
    catalogUnavailable: "模型目录不可用。",
    subscriptionStatusUnavailable: "无法获取订阅状态。",
    couldNotSignIn: "无法登录。",
    codeNotSent: "无法发送授权码。",
    couldNotInstall: "无法安装。",
    couldNotSignOut: "无法退出登录。",
    captureUnsupported: "此浏览器无法截取屏幕。",
    captureBlockedMac: "macOS 阻止了截屏：请在“系统设置 → 隐私与安全性 → 录屏与系统录音”中允许你的浏览器，然后重启浏览器。",
    captureEmpty: "共享的屏幕没有显示任何内容。",
    imagePrepare: "无法准备图片。",
    imageEncode: "无法编码图片。",
    retrying: (reason: string, attempt: number, of: number) => `${reason}，正在重试 ${attempt}/${of}…`,
  },
};
