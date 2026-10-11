# Safety notice

Read this before running BytNode-AI.

BytNode-AI gives AI agents real abilities on your computer: they run shell commands, read and
write files, call websites, spend your model credits, and — if you connect an exchange account —
place orders with real money. The app is built to **ask you first**, but you stay responsible for
what you approve.

**Nothing an agent says is investment advice.** Models make mistakes, invent numbers and misread
data. Check before you act.

---

## Before you start

1. **Keep the default scope.** Each agent works in its own folder
   (`~/.bytnode-ai/workspaces/<id>`). Only switch an agent to "Whole disk" if you need it to.
2. **Keep "Ask before acting".** In this mode, commands and file changes wait for your approval.
   "Run directly" skips those questions.
3. **Try an exchange on its testnet first.** Binance, Bybit, OKX and Gate.io have one.
4. **Create exchange API keys with the least rights.** Trading only, **never withdrawals**, and
   limited to your IP address if the exchange allows it.
5. **Watch your spending.** Every turn uses OpenRouter credit or your subscription's quota;
   sub-agents and scheduled tasks use it too.
6. **Read before you click Allow.** The request shows the exact command, file or order.

---

## What protects you

| Guard | What it does |
|---|---|
| **Workspace scope** | File tools refuse any path outside the agent's folder. A shell command that names an outside path is refused before it runs. |
| **Ask before acting** | Shells, file writes and edits, sub-agents and backtests wait for your approval in the conversation. |
| **Precise "Always"** | "Always" stores a narrow rule for that agent — a tool (`Write`) or the start of a command (`Bash(git status *)`) — never "allow everything". A rule only covers a **simple** command: anything chained, piped or substituted (`ls && del x`, `git status; git push`, `$(…)`) asks again. |
| **Dangerous commands** | Recursive deletes, disk formatting, `sudo`, `git push --force`, `curl … \| sh`, registry deletes, calls to the app's own API and similar commands ask **every time**, with no "Always" button. |
| **Money** | Placing an order, closing a position and transferring funds **always** ask — with every agent, subscription agents included, even in "Run directly" mode — and show a **LIVE** or **TESTNET** badge. For subscription agents BytNode-AI enforces this itself: its tool server does not run the action before your answer, whatever the agent's own settings. An order is sent **once**: if the exchange's answer is lost, the agent is told the outcome is unknown and must check before trying again — it is never re-sent automatically. |
| **No withdrawals** | There is no tool that sends funds off an exchange. |
| **Sub-agents and scheduled runs** | never receive the tools that commit funds; they have nobody to ask. |
| **Subscription agents** | API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`…) are removed from their environment, so your subscription is used, never a paid API key. |
| **Local server** | The app listens on `127.0.0.1` only. Its API refuses requests coming from other websites, and requests addressed to any name other than `localhost` / `127.0.0.1` (which blocks DNS-rebinding pages). Tool arguments are checked on the server too. |
| **Files written by agents** | are served with a sandbox policy, so a page or image an agent wrote cannot run code in the app. |
| **Plugins written by agents** | need your approval, given from your browser only (signed with a key it keeps), and run in a WebAssembly sandbox, one per plugin, with only the permissions you approved for that exact version of the code, and hard limits: memory (≈ 96 MB), CPU time per call, and a stop when a call runs too long. They never see your keys, and their orders go through the same confirmation as any other. |

---

## What is not protected

Be aware of these limits:

- **The shell guard reads text; it is not a jail.** A command that builds a path in an unusual way
  can get past it. "Ask before acting" is the real protection.
- **"Run directly" means no questions** for everything except money. Use it only for agents and
  folders you trust.
- **Subscription agents keep their own settings.** If you configured Claude Code, Codex or another
  agent to skip permissions, it may not ask BytNode-AI before acting — except for money actions,
  which always ask. Codex starts in its read-only mode, so it asks before writing or running a
  command; if you pick « Full access » in its mode menu, it acts freely on everything but money.
- **Programs already on your computer are trusted.** The server blocks websites, not local
  programs: anything running under your account can call the app's API, as it could read your files.
  Two things are locked against them: the money confirmation (a one-time code only your browser
  sees) and plugin approvals — they require a key kept in your browser, and a plugin runs only with
  an approval signed by it, so an agent cannot approve its own plugin nor write its approval file.
  Someone able to read your browser's profile could still get that key.
- **An agent with an unrestricted shell can reach beyond BytNode-AI's tools.** The confirmation
  covers the money tools BytNode-AI serves; an agent running commands on the whole disk could, in
  principle, use exchange keys some other way. Keep agents with exchange accounts in workspace scope.
- **In the desktop app, your keys are in your system's vault** (Windows DPAPI, the macOS Keychain,
  libsecret on Linux): encrypted for your user account, useless if the file is copied elsewhere. A
  program running in your own session can still ask for them. On a Linux with no keyring, and
  **in the browser (the `bytnode-ai` command), your keys are stored unencrypted** (`localStorage`):
  anyone with access to your account or your browser profile can read them.
- **Web content can mislead an agent.** A page it reads may contain instructions meant to steer it.
  Keep approvals on when agents browse.
- **Scheduled tasks run on their own** while the app is open, with the permissions of their agent.

---

## Where your data goes

| Data | Where it lives |
|---|---|
| Model, BytNode and exchange keys | desktop app: the system's vault (`secrets.vault`, encrypted); browser: `localStorage`. Sent only with your own requests to the local server |
| Settings and conversations | your browser's `localStorage` |
| Workspaces, installed agents, skills, plugin data | `~/.bytnode-ai/` on your disk (`BYTNODE_AI_HOME` to move it) |

What leaves your computer:

- your messages and tool results, to the model provider (OpenRouter, or your subscription's vendor);
- market-data queries, to BytNode;
- API calls, to the exchanges you connected;
- web searches and pages the agents fetch.

BytNode-AI has no account, no telemetry and no server of its own in between.

---

## Reporting a security problem

Please do not open a public issue for a vulnerability. Use
[GitHub's private vulnerability reporting](https://github.com/benjfrem07/bytnode-ai/security/advisories/new)
or contact BytNode at https://bytnode.com. Include what you found, how to reproduce it, and the
version (`bytnode-ai --help` prints it).
