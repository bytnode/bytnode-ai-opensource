# BytNode-AI

**AI finance agents that run on your own computer.**

You create agents, give each one a profession and a folder to work in, and talk to them in a chat.
They read market data from [BytNode](https://bytnode.com), write and run code, chart, backtest,
follow your exchange accounts — and they ask before doing anything that matters.

```bash
npx bytnode-ai
```

- **Your models, your way** — any model on OpenRouter with your key, or the subscription you
  already pay for: Claude, ChatGPT (Codex), Gemini, GitHub Copilot, Grok.
- **Four professions** — Standard, Analyst, Strategist, Quantitative, each with its own prompt
  and skills.
- **Real market data** — BytNode's API over MCP: prices, candles, funding, open interest,
  liquidations, indicators.
- **Plugins** — watchlist, portfolio, alerts, paper trading, DCA, calendar, scheduled tasks… and
  plugins your agents write for you.
- **Exchange trading** — ten exchanges, every order confirmed by you, no withdrawal possible.
- **Local first** — your keys and conversations stay in your browser; your files stay on your disk.

---

## Contents

1. [Get started](#get-started)
2. [How it works](#how-it-works)
3. [Features](#features)
4. [Safety](#safety)
5. [Configuration](#configuration)
6. [Development](#development)
7. [License](#license)

---

## Get started

```bash
npx bytnode-ai          # first time: installs the `bytnode-ai` command, then opens http://localhost:3777
bytnode-ai              # every time after that
npx bytnode-ai@latest   # update
```

| Option | Effect |
|---|---|
| `--port N` | serve on another port (default `3777`) |
| `--no-open` | do not open the browser |
| `--no-install` | with `npx`: run without installing the command |

Stop it with **Ctrl-C** in the terminal.

**Requirements**

- **Node.js** 20.19+ or 22.12+ (22+ for watching WebSocket streams).
- **Optional:** Python 3 with `pandas` and `numpy` for backtests (`python3 -m pip install pandas numpy`).
- **Linux only:** `zenity` or `kdialog` for the "Browse…" folder picker (otherwise type the path).

Works on **Windows, macOS and Linux**.

**First launch.** A short wizard asks for:

1. your profile — a few words about you, given to every agent;
2. how you pay for models — a subscription (sign in) or an OpenRouter key — and your BytNode key;
3. your first agent — name, model, profession, workspace folder, permissions.

---

## How it works

```
 you ── browser (localhost:3777) ── local server (Next.js, on your machine)
                                        │
            ┌───────────────────────────┼───────────────────────────┐
       OpenRouter                subscription agent              BytNode
   (your key, any model)   (Claude Code, Codex, Gemini CLI,   (market data, MCP)
                             Copilot CLI, Grok Build — ACP)
```

**An agent** = a name, a model, a **profession**, a **workspace** (the folder it works in), a
permission mode, and optionally some context (text, files) and exchange accounts. The left column
lists your agents; each has its own conversations.

**Two engines, one app.**

- **OpenRouter** — BytNode-AI runs the agent itself: model → tools → model, up to 40 turns.
- **Subscription** — the vendor's own agent runs (Claude Code, Codex…), launched locally through
  the [Agent Client Protocol](https://agentclientprotocol.com). BytNode-AI gives it the profession,
  the skills, the BytNode data and its own tools. Your subscription is used, never an API key:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`… are removed from its environment.

Subscription agents are not bundled. Click **Install** and they go into
`~/.bytnode-ai/agents/<id>/`; `gemini`, `copilot` and `grok` already on your PATH are recognised.
Agents installed this way keep themselves up to date.

**The professions.** Each one is plain files in `professions/`: a `PROMPT.md` and its skills.

| Profession | Role | A few of its skills |
|---|---|---|
| **Standard** | generalist, first point of contact | market reading, short answers, routing a question |
| **Analyst** | data → trends and scenarios, macro included | trend analysis, macro context, calibrated scenarios |
| **Strategist** | complete, testable strategies | strategy design, risk management, backtest plan |
| **Quantitative** | maths, statistics, Python, honest backtests | Python quant, statistical validation, leakage checks |

Shared skills (`professions/_commun/skills/`) cover how to query BytNode, the shape of a financial
answer, deep research, verified calculations, trading execution, and writing plugins. Your own
skills go in `~/.bytnode-ai/skills/` (format: [`skills/README.md`](skills/README.md)).

---

## Features

### Tools

Every agent has the same base set:

| Group | Tools |
|---|---|
| Files | `Read` (text, images, PDF, notebooks), `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep` |
| Shell | `Bash`, `PowerShell` (Windows, or wherever `pwsh` is installed), `Monitor` (watch a command or a WebSocket, 10 min max) |
| Web | `WebSearch`, `WebFetch` |
| Work | `Workflow` (sub-agents), `Skill`, `TodoWrite` (the agent's visible task list), `Memory` (dated notes, the last 25 in every prompt) |
| Market | every BytNode tool (`get_market_data`, `get_history`, `get_market_indicators`…) — read-only, never asks |

**Sub-agents.** With `Workflow`, an agent splits a request into independent tasks: three
sub-agents at a time, eight at most. Each one is one of the four professions and gets a model
chosen for the difficulty of its task. Sub-agents report back; they never touch an exchange
account. You see one row per task, unfolding onto its report.

### Plugins

Plugins add tools for the agents and tabs for you. All can be switched off in the library.

| Plugin | What it does |
|---|---|
| **Charts and backtests** | BytNode data to CSV (`SaveMarketData`), PNG charts (`Chart`), and a standard Python backtest engine (`Backtest`: fees, slippage, funding, risk sizing, in/out of sample) |
| **Watchlist** | your assets live, a chart, market facts and signals |
| **Portfolio** | one view of all your exchange accounts: value curve, performance, allocation |
| **Paper trading** | several simulated portfolios — never real money |
| **Alerts** | be told when a price or an indicator (RSI, EMA, MACD, Bollinger…) crosses a level |
| **Recurring purchases (DCA)** | buy a fixed amount on a schedule — simulated or real, always confirmed |
| **Scheduled tasks** | agents that work on their own at set times |
| **Calendar** | market events and your tasks, written by your agents |
| **Position calculator** | size, liquidation price, risk/reward before a trade |
| **Report export** | an analysis as a standalone HTML or Markdown document |

**Plugins written by your agents.** Ask an agent for a plugin ("track my staking rewards") and it
designs one with you, writes it, tests it in the app, and asks for your approval. It shows in the
conversation what the plugin may reach: the network, BytNode, your exchange accounts (Test or
Real). The plugin's code runs in a **WebAssembly sandbox** with only what you granted; it
never sees your keys. Its tab is a sandboxed page in the app's style. Plugins live in
`~/.bytnode-ai/bytnode-plugin-user/`, one folder each.

### Exchange trading

Add accounts in **Settings → Authentication → Exchange accounts** (API key, secret, passphrase when
needed, testnet when available). **Test** connects and reads the balance. Each agent then picks
which accounts it may use; an agent without an account has no exchange tool.

- **Reading, without asking** — `ExchangeBalance`, `ExchangePositions`, `ExchangeOrders`,
  `ExchangeTicker`, `ExchangeWatch`.
- **Acting, always with your approval** — `PlaceOrder` (market, limit, stop, stop-limit,
  take-profit), `CancelOrder`, `ClosePosition`, `Transfer` (between wallets of the same account),
  `SetLeverage`.

| Exchange | Futures | Spot ↔ futures transfer | Testnet | Worth knowing |
|---|---|---|---|---|
| Binance | yes | yes | yes | Spot and futures testnet keys are distinct. |
| Bybit | yes | unified account | yes | Testnet keys from testnet.bybit.com. |
| OKX | yes | unified account | demo | Passphrase; demo keys from demo mode. |
| Coinbase | no | — | no | Advanced Trade; the secret is the CDP key's EC private key. |
| Kraken | no | — | no | Kraken Futures uses separate keys, not supported. |
| Bitget | yes | yes | no | Passphrase; the account must be one-way. |
| KuCoin | yes | yes | no | Passphrase; one key (Spot + Futures) serves both. |
| Gate.io | yes | yes | yes | No margin mode through the API. |
| HTX | yes | no | no | No margin mode through the API. |
| MEXC | read-only | yes | no | MEXC closed futures orders to API users in 2022. |

Futures are one-way (one position per pair); a hedge-mode account is refused. Deposits that land
in a funding wallet (Bybit, OKX, KuCoin, Binance) are read too, and `Transfer` can move them to
trading. Your PC clock is compensated automatically — an exchange's "timestamp" refusal is
named as a clock gap.

### The chat

- **The `+` menu.** *Add files* drops them into `entrees/` in the workspace, and the agent reads
  them with its tools: a 100 000-row CSV stays usable. You can also drag files onto the message
  field. *Take a screenshot* captures one frame through the browser. *Deep research* makes the
  next answer search several times, check sources and date everything.
- **Commands.** Type `/` for the list. `/compact [instructions]` replaces the thread with a
  structured summary, like Claude Code.
- **Context meter.** Bottom right: context used, tokens per second, cost of the turn. On
  OpenRouter, context is managed for you: old tool outputs are trimmed at 70 %, the thread is
  compacted at 90 %, and a "context too long" refusal is recovered automatically.
- **Resilience.** A dropped connection or a 429/502 is retried. **Retry** after an interruption
  resumes the answer where it stopped. An agent that repeats the same failing call is told to
  change approach.
- **Plan and reasoning** are shown (a checklist, a folded "thinking" block), never replayed to
  the model.

---

## Safety

BytNode-AI acts on your machine, so it is built to ask first.

| Guard | What it means |
|---|---|
| **Workspace scope** | By default an agent reads and writes only inside its folder; a shell command naming an outside path is refused before it runs. "Whole disk" is an explicit choice per agent. |
| **Ask before acting** | Shells, file writes, sub-agents and backtests wait for your approval in the thread. **Always** remembers a precise rule (`Write`, `Bash(git status *)`), never "everything". |
| **Dangerous commands** | `rm -rf`, formatting, `sudo`, `git push --force`, `curl … \| sh`, registry deletes… ask every time and never get an "Always" button. |
| **Money** | Orders, position closes and transfers **always** ask, even in "Run directly" mode, with a **LIVE** / **TESTNET** badge. There is no withdrawal tool. |
| **Sub-agents and background runs** | never receive the tools that commit funds. |
| **Local server** | Every `/api` route refuses requests from other websites. Files written by agents are served with a sandbox policy. |
| **Agent-written plugins** | run in a WebAssembly sandbox, with the permissions you approved for that exact code. |

The shell guard reads the command text; it is a safeguard, not a jail — "Ask before acting" is
the real protection.

**Where your data lives**

| What | Where |
|---|---|
| Keys, settings, conversations | your browser's `localStorage` (they travel only with your own requests) |
| Workspaces, installed agents, skills, plugin data | `~/.bytnode-ai/` (change with `BYTNODE_AI_HOME`) |
| What leaves your computer | model requests (OpenRouter or the vendor of your subscription), BytNode queries, exchange calls |

---

## Configuration

All optional, set in the server's environment.

| Variable | Default | Effect |
|---|---|---|
| `BYTNODE_AI_HOME` | `~/.bytnode-ai` | where data lives |
| `BYTNODE_MCP_URL` | `https://api.bytnode.com/mcp` | BytNode's MCP server |
| `OPENROUTER_BASE_URL` | OpenRouter | another host: a relay, or a fake OpenRouter for tests |
| `OPENROUTER_SEARCH_MODEL` | `deepseek/deepseek-v4.1-flash` | the model behind `WebSearch` |
| `OPENROUTER_PROVIDER_SORT` | `latency` | `latency`, `throughput` or `price` |
| `OPENROUTER_IGNORE_PROVIDERS` | `parasail` | providers to exclude (empty = none) |
| `OPENROUTER_PROVIDER_ORDER` | — | an explicit provider order (wins over the sort) |
| `OPENROUTER_ALLOW_FALLBACKS` | `1` | `0` forbids any other provider |

Why sort providers: OpenRouter serves one model through several providers, and the same turn
measured 3 s, 34 s or 98 s depending on who received it.

---

## Development

```bash
npm install
npm run dev          # http://localhost:3777
```

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, with the React Compiler rules |
| `npm test` | Vitest on `lib/` (one file: `npx vitest run lib/tools/paths.test.ts`) |
| `npm run build` | production build |
| `npm run smoke:pack` | the package as a user gets it: pack, install in a temp folder, start, query |
| `npm pack --dry-run` | clean build + archive check (no key, no personal file, no machine path) |
| `npm run vierge` | first-launch state: temporary data, no agent found, fresh port |

`typecheck`, `lint` and `test` must be clean before a change is done. CI runs them, plus
`smoke:pack`, on Windows, macOS and Linux.

**Stack.** Next.js 16 (App Router, Turbopack) · React 19 · strict TypeScript · hand-written CSS
(BytNode's tokens and fonts: Geist, Inter, IBM Plex Mono) · Vitest.

**Layout**

```
app/                 pages and API routes (chat relay, tool execution, ACP, plugins, files, system)
components/          chat, onboarding, settings, shell (tabs), plugin views, ui
lib/
  agent/             the agent loop (runs in the browser and on the server), prompts, history,
                     compaction, usage, resilience
  tools/             one file per tool; registry.ts assembles them; permissions, policy, validation
  acp/               subscription agents: install, launch, sessions, sign-in, protocol translation
  mcp/               BytNode client, and the local MCP server that serves our tools to ACP agents
  plugins/           plugin runtime (core/), the ten plugins, agent-written plugins (user/)
  catalog/           OpenRouter models, providers, efforts
  state/, storage/   browser stores (localStorage) and migrations
  server/            data folder, workspaces, origin check, process groups
professions/         PROMPT.md + skills per profession, shared skills in _commun/
bin/bytnode-ai.mjs   the command-line launcher
```

**Adding things**

- **A tool** — one file in `lib/tools/` implementing `Tool { name, description, parameters, policy, execute }`, plus one line in `registry.ts`.
- **A profession** — a folder in `professions/` plus an entry in `lib/professions/catalog.ts`.
- **A plugin** — a `manifest.ts` and an `index.ts` (`definePlugin`) under `lib/plugins/<id>/`, registered in both `catalog.ts` and `definitions.ts`.

---

## License

Free for any **noncommercial** use — personal, research, education, hobby, nonprofit — under the
[PolyForm Noncommercial License 1.0.0](LICENSE): use it, study it, change it, share it.
Commercial use needs a commercial license: contact BytNode at https://bytnode.com.
Versions up to 0.1.3 were published under the MIT license and remain so.
