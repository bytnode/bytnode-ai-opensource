<div align="center">

# BytNode-AI

**Local AI finance agents: they read live market data, write and run code, chart, backtest and
follow your exchange accounts — on your own computer.**

[![npm](https://img.shields.io/npm/v/bytnode-ai)](https://www.npmjs.com/package/bytnode-ai)
![Node](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-495057)
![Status](https://img.shields.io/badge/status-early%20version-e8590c)

[Documentation](https://ai.bytnode.com/docs) · [Install guide](https://ai.bytnode.com/docs/install) ·
[Safety notice](SAFETY.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

---

BytNode-AI is a local app made by [BytNode](https://bytnode.com). You create agents, give each one
a profession and a folder to work in, and talk to them in your browser. The app runs on your
machine (`127.0.0.1`): your keys stay in your browser, your data in `~/.bytnode-ai/`.

> **Early version.** BytNode-AI changes quickly: expect breaking changes between versions.
> Agents run commands and write files on your machine, and can trade on the exchange accounts you
> connect. **Read the [safety notice](SAFETY.md) before running it.**

## Quick start

Install [Node.js](https://nodejs.org) (20.19+ or 22.12+), then run:

```bash
npx bytnode-ai
```

This installs the `bytnode-ai` command and opens the app at http://localhost:3777. After that, run
`bytnode-ai`; stop it with **Ctrl-C**.

| Option | Effect |
|---|---|
| `npx bytnode-ai@latest` | update to the latest version |
| `--port 4000` | use another port |
| `--no-open` | do not open the browser |

On first launch you sign in to your BytNode account in the browser (a BytNode market-data key is
created for the app if you have none), then a short setup asks for your profile and how you pay
for models. See the [install guide](https://ai.bytnode.com/docs/install).

## Key features

| | |
|---|---|
| **Models** | Your own key at a vendor — OpenAI, Anthropic, Google, xAI, DeepSeek, Kimi, Qwen, Mistral, GLM — your OpenRouter key, or your ChatGPT Plus or Pro plan with « Sign in with ChatGPT ». |
| **Professions** | Four agent profiles — Standard, Analyst, Strategist, Quantitative — each with its own prompt and versioned skills (sourcing, verified calculations, risk sizing, anti-leakage backtests…). |
| **Market data** | Live and historical crypto data from [BytNode](https://bytnode.com): prices, order flow, derivatives, liquidations, options, macro, on-chain and sentiment, read by the agents over MCP and by the app over REST and WebSocket. |
| **Tools** | Files (read, write, edit, search), shell (Bash, PowerShell), web search and fetch, persistent memory, and parallel sub-agents (`Workflow`) for multi-step research. |
| **Plugins** | Ten built-in plugins — charts and backtests, watchlist, portfolio, paper trading, alerts, recurring purchases, scheduled tasks, calendar, position calculator, report export — and plugins that agents write themselves, run in a WebAssembly sandbox after your approval. |
| **Exchange trading** | Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate.io, HTX and MEXC (through ccxt): balances, positions, orders, and actions that always ask for your confirmation. |
| **Notifications** | Alerts and scheduled-task reports in the app, and optionally on Telegram. |
| **Interface** | English, French, Spanish and Chinese; floating widgets on the conversation page. |

## Safety by design

| Guard | What it does |
|---|---|
| **Workspace scope** | Each agent works in its own folder; file tools refuse any path outside it, links included. |
| **Ask before acting** | Commands and file changes wait for your approval; « Always » rules are narrow, never « allow everything ». |
| **Money** | Orders, cancels, position closes, leverage changes and transfers **always** ask — with a LIVE / TESTNET badge, a size preview and optional per-account caps. An order is sent **once**, never re-sent automatically. There is no withdrawal tool. |
| **Unattended runs** | Sub-agents and scheduled tasks never get the tools that commit funds, are read-only by default, and have a token budget. |
| **Local server** | Listens on `127.0.0.1` only, refuses other websites and DNS rebinding, and acts only for your own browser tab. |
| **Records** | Every exchange action goes to an order journal in `~/.bytnode-ai/audit/`; the app log keeps 14 days, keys removed. |

The full list — and what is **not** protected — is in the [safety notice](SAFETY.md).

## How it works

```
 browser (localhost:3777)                 local server (Next.js, on your machine)
 UI, keys, settings, conversations  ──▶   tools, files, plugins, scheduled jobs
                                                │
                                                ├──▶ model vendors / OpenRouter / ChatGPT plan
                                                ├──▶ BytNode MCP server (agents' market data)
                                                ├──▶ BytNode REST API + WebSocket (app's market data)
                                                └──▶ exchanges (ccxt)
```

- **No backend of its own:** the server runs on your machine and every `/api` route acts on it.
- **Keys never touch the server's disk:** they stay in the browser and travel with each request.
- **User data outside the project:** workspaces, skills and plugin data live in `~/.bytnode-ai/`
  (`BYTNODE_AI_HOME`), so an update never touches them.

Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## From source

```bash
git clone https://github.com/benjfrem07/bytnode-ai.git
cd bytnode-ai
npm install
npm run dev          # http://localhost:3777, reloads as you edit
```

Before calling a change done:

```bash
npm run typecheck && npm run lint && npm test
npm run smoke:pack   # pack, install the archive in a temp folder, start it
```

Stack: Next.js 16 · React 19 · strict TypeScript · hand-written CSS · Vitest. Start with the
[architecture documentation](ARCHITECTURE.md): how the app is built, where each part lives, and the
configuration variables.

## Community and support

- Report a bug or suggest an idea in [GitHub Issues](https://github.com/benjfrem07/bytnode-ai/issues).
- Report a security problem privately, as described in [SAFETY.md](SAFETY.md#reporting-a-security-problem).
- Get a BytNode account and market-data key at [bytnode.com](https://bytnode.com).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal, research, educational and nonprofit
use. For commercial use, contact BytNode at https://bytnode.com.
Versions up to 0.1.3 were published under the MIT license and remain so.
