import type { Messages } from "../en";

export const account: Messages["account"] = {
  welcome: "欢迎使用 BytNode-AI",
  lede: "你的市场智能体，就在这台电脑上。用你的 BytNode 账户登录，一分钟内即可就绪。",
  finishInBrowser: "请在浏览器中完成登录，然后回到这里。",
  openAgain: "重新打开页面",
  settingUp: "已登录。正在准备你的智能体…",
  signIn: "通过浏览器登录",
  note: "已在 bytnode.com 登录？在那里点一下即可返回。第一次使用 BytNode？在同一页面免费注册账户。",
  signedOut: (reason: string) => `你已退出登录：${reason}`,

  keyLimit: "你的账户已有 10 个 BytNode 密钥，因此无法为此应用再创建一个。请粘贴你已有的密钥，或在 BytNode 控制台中撤销一个。",
  keyFailed: (detail: string) => `无法为此应用创建 BytNode 密钥（${detail}）。请粘贴你已有的密钥。`,

  errors: {
    timeout: "登录耗时过长，请重试。",
    unreachable: (detail: string) => `无法连接 bytnode.com（${detail}）。`,
    cannotWait: (detail: string) => `应用无法等待浏览器响应（${detail}）。`,
    noBrowser: (detail: string) => `无法打开浏览器（${detail}）。`,
    answered: (status: string) => `bytnode.com 返回了 ${status}。`,
    notSignedIn: "尚未登录。",
    refused: "已拒绝。",
  },
};
