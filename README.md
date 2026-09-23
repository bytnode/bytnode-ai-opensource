# BytNode-AI

Local AI finance agents: each one has a profession (Standard, Analyst, Strategic,
Quantitative), tools (files, shells, web, sub-agents) and a market-data source, BytNode,
queried over MCP. Models come from OpenRouter (by key) or from your **subscription**
— Claude, OpenAI, Gemini, GitHub Copilot, Grok — in which case it is the
vendor's own agent (Claude Code, Codex, Gemini CLI, Copilot CLI, Grok Build) that runs, dressed by BytNode-AI, through the ACP protocol.

**Next.js 16 (App Router) · React 19 · strict TypeScript · hand-written CSS · Vitest.**
The background is BytNode's (`components/fond`), with the same tokens (`--ink`, `--paper`,
`--voile`) and the same fonts (Geist, Inter, IBM Plex Mono).

## Install

```bash
npx bytnode-ai        # once: installs the bytnode-ai command, then starts http://localhost:3777
bytnode-ai            # every time after that
npx bytnode-ai@latest # update
```

Requirements: Node ≥ 20.9. Optional: Python + pandas (Backtest tool), `zenity` on Linux
(folder picker). Data — workspaces, subscription agents, personal skills — lives in
`~/.bytnode-ai/` (`BYTNODE_AI_HOME` to change it); keys and conversations in the browser's
`localStorage`. To quit: Ctrl-C in the terminal.
Options: `--port N`, `--no-open`; `--no-install` so that `npx` does not install the command.

The six subscription agents are not bundled: an agent already installed on the machine
(`gemini`, `copilot`, `grok`) is recognised; the others install on the first click on
"Install", into `~/.bytnode-ai/agents/<id>/`.

## Develop

```bash
npm install
npm run dev        # http://localhost:3777 (port 3000 is left free)
```

On first launch, the setup wizard opens over the background: profile (including a few words
about you, passed to every agent), **Authentication** (Subscription tab: six vendors, a
Sign in button — or Install for those that download; Keys tab: OpenRouter; the BytNode key in
both cases), then a first agent (name, provider, profession, text + file context, workspace
picked in the file explorer, scope, tool mode). The left column then lists your **agents**;
the one you open shows its conversations. "New agent" asks neither for the profile nor for
the key again. The pencil edits an agent, the bin deletes it along with its conversations,
the cog at the bottom reopens the account (profile + key). Everything is remembered in
`localStorage` (`agentchat:settings`, `agentchat:conversations`); nothing leaves the computer
except what goes to OpenRouter.

```bash
npm test           # Vitest on lib/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
npm run smoke:pack # the package as a user receives it (npm pack, install, start)
npm pack --dry-run # prepack: clean build + archive check (nothing forbidden, no key)
npm run vierge     # as on first launch: temporary data, no agent recognised, fresh port (empty localStorage); --no-build, --no-open
```

`OPENROUTER_BASE_URL` (server) redirects the calls to another host — a relay, or a fake
OpenRouter to test the flow without a key.

### Which provider the request goes to

The same model is served by several providers, and their latencies have nothing in common: by
default OpenRouter load-balances, and the same turn can answer in 3 s or in 34 s depending on
who receives it (measured). All our requests therefore carry `provider: { sort: "latency", ignore: ["parasail"] }`
(`lib/server/provider-routing.ts`). Adjustable through environment variables:

| Variable | Default | Effect |
|---|---|---|
| `OPENROUTER_PROVIDER_SORT` | `latency` | `latency`, `throughput` or `price` |
| `OPENROUTER_IGNORE_PROVIDERS` | `parasail` | list to exclude; empty = nobody |
| `OPENROUTER_PROVIDER_ORDER` | — | explicit order; takes precedence over the sort |
| `OPENROUTER_ALLOW_FALLBACKS` | `1` | `0` forbids any other provider (risk of failure) |

### By subscription (ACP)

Nothing is bundled (`lib/acp/packages.ts` says where each one comes from). The five agents are npm
packages (Claude Code, Codex, Gemini CLI, Copilot CLI, Grok Build): `Install` writes a `package.json`
in `~/.bytnode-ai/agents/<id>/` and runs `npm install` there (`lib/acp/install.ts`); `gemini`,
`copilot` and `grok` already installed globally are recognised on the PATH (`lib/acp/detect.ts`).
When a BytNode-AI release raises an adapter's range, the button becomes `Update`.
`Sign in` opens the browser on the vendor's page (Claude and Copilot: in a terminal window;
OpenAI: `codex login`; the others: the `authenticate` method the agent announces — a personal
account, never an API key), and the state re-reads itself. For agents without a status CLI,
"signed in" = a probe session accepted (`lib/acp/auth.ts`, 90 s cache).

An agent whose provider is `acp:claude` / `acp:openai` / `acp:gemini` does not run our loop:
the server (`lib/acp/`) launches the external agent as a subprocess (JSON-RPC over stdio),
**one session per conversation** (`session/new`, reloaded by `session/load` after a restart,
killed after 15 min of silence), passes it **BytNode as an HTTP MCP server**, drops the
profession's skills into `.agents/skills/` and `.claude/skills/` of the workspace, and gives it
the BytNode-AI prompt (Claude: on top of the system prompt; Codex / Gemini: at the head of the
first message). Its tools are its own; its permission requests take our Allow / Always / Deny
buttons (Ask mode) or are accepted (Direct mode). Models and effort come from the agent's
session options (`lib/acp/models.ts`, 1 h cache).

The `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` keys are stripped from the subprocesses' environment:
the subscription must be billed, not the API. For Claude, a `.claude/settings.local.json` is
placed in the workspace (`permissions.defaultMode: default`) and the user's personal settings
are not loaded.

## Architecture

```
app/
  layout.tsx, page.tsx            shell: wizard as an overlay when not configured, otherwise the chat
  api/chat/route.ts               POST → relays a streamed completion (SSE) from OpenRouter, tools included
  api/tools/route.ts              GET → resolved workspace, tool specifications, skills
  api/tools/execute/route.ts      POST → runs a tool, NDJSON stream (lines, sub-agents, result)
  api/openrouter/models/route.ts  GET → catalog (1 h cache, no key required)
  api/openrouter/key/route.ts     GET → checks a key
  api/bytnode/key/route.ts        GET → checks a BytNode key (MCP connection)
  api/acp/auth|models|prompt|permission|cancel   the subscription agents (see above)
  api/system/pick-folder/route.ts POST → the native folder picker
components/
  fond/        FondMarine (ported from BytNode)
  onboarding/  Wizard, StepProfil, StepAuth (Subscription | Keys), StepAgent, ProviderPicker, ContextFiles, FolderField
  chat/        ChatShell, Sidebar, Thread, Message, Composer, ModelPicker, useChat
  ui/          Field, SearchPanel (list + search, shared), ThemeToggle, icons
lib/
  domain/      types (Profile, ApiKeys, AgentConfig[], Conversation{agentId}, Message{steps}, Model, Provider)
  llm/         interface LlmClient { streamChat() } + OpenRouterClient + SSE reader (text, tool_calls)
  agent/       loop.ts (the model → tools → model loop, isomorphic), history.ts (steps → messages),
               tool-calls.ts (reassembling fragments), events.ts, prompt.ts, tools-prompt.ts
  acp/         agents.ts (catalog, shared), launch.ts, install.ts, connection.ts, sessions.ts, translate.ts,
               auth.ts, models.ts, prompt.ts, skills-sync.ts, prepare.ts, client.ts + use-auth.ts (browser)
  tools/       ← THE TOOLS FOLDER: types.ts (interface Tool), registry.ts, names.ts (gated tools)
    fs/        Read (text, images, PDF, .ipynb), Write, Edit (single string), NotebookEdit, Glob, Grep (bundled ripgrep)
    exec/      run.ts (bounded spawn), shells.ts (Bash via Git bash, PowerShell), monitor.ts (command or WebSocket, bounded)
    web/       search.ts (OpenRouter's web plugin, 45 s × 2), fetch.ts (turndown + GFM, SSRF guard)
    agents/    subagent.ts (pure: schema, prompt, report), workflow.ts (sub-agents by profession, server-side)
    skills/    skill.ts (skills/<name>/SKILL.md: workspace, project, ~/.agents/skills)
    client.ts  what the browser sees of them (specs + execution through the route)
  catalog/     OpenRouter models → providers, "latest releases", search
  storage/     interface Storage + BrowserStorage/MemoryStorage; repositories
  agent/       buildSystemPrompt(profile, agent)
  state/       stores (useSyncExternalStore): settings, conversations, catalog
  server/      what the routes know about OpenRouter
```

### The professions

`professions/<id>/PROMPT.md` is the profession's system prompt, `professions/<id>/skills/<name>/SKILL.md`
its own skills, `professions/_commun/skills/` the ones shared by all (`source-bytnode`:
how to query the source; `reponse-financiere`: the shape of an answer). Everything is a file,
editable by hand. An agent's final prompt = user profile + profession prompt +
agent context + Environment section (tools, scope, BytNode status, skills).

| Profession | Prompt | Own skills |
|---|---|---|
| Standard | finance/crypto generalist, first point of contact | lecture-marche |
| Analyst | data → trends and scenarios, macro built in | analyse-tendance, contexte-macro, rapport-analyse |
| Strategic | complete, testable strategies, crypto-focused | conception-strategie, gestion-risque, plan-backtest |
| Quantitative | maths, stats, Python, honest backtests | python-quant, validation-statistique, backtest-python |

### BytNode (data source)

Remote MCP server (`https://api.bytnode.com/mcp`, overridable with `BYTNODE_MCP_URL`),
`X-API-KEY` header, key entered on the Keys page (Check button). Its tools (`get_system_info`,
`get_market_data`, `get_history`, `get_market_indicators`, `get_market_emotions`…) are discovered at
connection time (`lib/mcp/bytnode.ts`) and given to every agent on top of the base tools, never
subject to permission (read-only). Without a key, the agents know it and say so.

### The tools

All agents share the same base set: Read, Write, Edit, NotebookEdit, Glob, Grep, Bash,
PowerShell, Monitor, WebSearch, WebFetch, Workflow, Skill — plus four finance tools
(Memory in `lib/tools/finance/`, the other three in the *Finance tools* plugin,
`lib/plugins/finance-tools/`):

- **SaveMarketData**: a BytNode tool → a CSV in the workspace, without the rows going
  through the model (the table is found in the JSON response, whatever its shape).
- **Chart**: a PNG chart (candles or line, volume, overlaid columns, markers, levels)
  from a CSV, rendered as SVG then rasterised (`@resvg/resvg-js`); the image is attached to the
  result (the model sees it) and shown in the thread (served by `/api/files`, never outside the folder).
- **Backtest**: the standard engine `py/backtest.py` (Python + pandas) — the agent only writes
  `signal(df)` / `stop_distance(df)`; next-candle execution, fees, slippage, funding,
  risk-based sizing, in/out-of-sample, metrics per period and per year, buy-and-hold,
  equity curve. Subject to permission (it runs the agent's Python).
- **Memory**: dated notes in `.bytnode-ai/memory.jsonl` of the workspace; the last 25
  are slipped into the prompt of every turn (`/api/memory`).
- **TodoWrite**: the agent's task list on a long request, sent in full on every
  call and shown in the thread (the same "plan" block as the subscription agents).

Context manages itself (OpenRouter engine): beyond 70 % of the model's window, old
tool results are pruned from what the model receives (the displayed thread keeps everything);
at 90 % at the end of a turn, the thread is compacted automatically; if the provider refuses the
context, the thread is compacted and your message replayed. The arguments of every tool call are
checked against its schema before any execution: an ill-formed call goes back to the model with the reason.

Subscription agents receive the same four tools through a local stdio MCP server
(`lib/mcp/finance-server.ts`, run with `tsx`), passed in `session/new` next to BytNode. Every tool is a file in
`lib/tools/` that implements `Tool { name, description, parameters, execute(args, ctx) }`;
`registry.ts` assembles them. Adding a tool = one file + one line in the registry.

The loop (`lib/agent/loop.ts`) runs **in the browser** for the main agent (model through
`/api/chat`, tools through `/api/tools/execute`, permissions asked on screen) and **on the
server** for Workflow sub-agents (everything in-process). An assistant message remembers its
*steps* (text, calls, results) and `history.ts` replays them in the provider's format.

- **Workspace and scope**: every agent has a folder (`~/.bytnode-ai/workspaces/<id>` by default,
  or picked in the file explorer) where shells start and where relative paths resolve.
  Scope `Workspace only` (file tools refuse any outside path;
  a shell command that names one is refused before it runs) or `Whole disk`.
- **Permissions**: per agent, `Ask before acting` (Bash, PowerShell, Monitor, Write, Edit,
  NotebookEdit, Workflow wait for approval in the thread; "Always for this agent" switches
  to direct) or `Run directly`. Toggleable in the chat header.
- **WebSearch**: OpenRouter's `web` plugin, on the OpenRouter key (search model:
  `OPENROUTER_SEARCH_MODEL`, default `deepseek/deepseek-v4.1-flash`); 45 s, two attempts.
- **Skills**: `skills/<name>/SKILL.md` (YAML front-matter `name`, `description`). The ones you
  write go in `skills/` at the root (see `skills/README.md`): agents on OpenRouter read them
  there, subscription agents get a copy in `.agents/skills/` and
  `.claude/skills/` of their workspace (`lib/acp/skills-sync.ts`: idempotent, does not touch
  what you wrote by hand, removes what the project no longer provides). The agent's
  workspace and `~/.agents/skills` are read too. All of them are listed in the prompt and loaded
  by the Skill tool.

### Trading on an exchange

In **Authentication**, the "Exchange accounts" section accepts as many accounts as you want among Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate.io, HTX and MEXC: a name (the one the agent will use, "Binance-main"), the API key, the secret, a passphrase for those that require one, and "testnet" when the exchange has one. "Test" opens the connection and reads the balance. The keys stay in your browser, like the others, and travel with every tool request. Create them on the exchange side with the rights you want to grant — the application has no withdrawal tool anyway.

Each agent then picks, in its configuration, **which accounts it may drive**. Without an attached account, it has no exchange tool. With one, it gets:

- **read, without permission**: `ExchangeBalance` (balances, USD estimate), `ExchangePositions` (futures positions, PnL, liquidation), `ExchangeOrders` (open orders or history with fees), `ExchangeTicker` (price, order book, funding on *that* exchange), `ExchangeWatch` (a reading every N seconds for 10 minutes at most, stopping on `price>=…`, `pnl<…`, `liq<3%` or `closed`);
- **action, with permission**: `PlaceOrder` (market, limit, stop, stop-limit, take-profit; amount in the asset or in the quote currency; `reduceOnly`, leverage), `CancelOrder`, `ClosePosition` (all or a fraction), `Transfer` (spot ↔ futures of the same account), `SetLeverage`.

An order, a position close or a transfer **is always asked of you** — even when the agent is in "Run directly", and without an "Always" button. Every request carries a **LIVE** (red) or **TESTNET** badge that says which money the action is about; the conversation header only flags **TESTNET** (a live account is the normal case, not a permanent alert). Futures are handled one-way (one position per pair); an account in hedge mode is refused with a message. Subscription agents (Claude Code, Codex…) receive the same tools through the `bytnode-ai` MCP server.

Two shared skills guide the agents: `trading-execution` (balance → price → size → order → confirmation) and `trade-review` (review of positions and history, alert thresholds).

Every exchange has its limits, taken from its documentation and from ccxt; the application knows them and refuses before any call, with the reason — the agent reads them in its prompt too:

| Exchange | Futures | Spot ↔ futures transfer | Testnet | Worth knowing |
| --- | --- | --- | --- | --- |
| Binance | yes | yes | yes | The spot testnet (testnet.binance.vision) and futures testnet (testnet.binancefuture.com) keys are distinct. |
| Bybit | yes | no — unified account, a single balance | yes | Testnet keys created on testnet.bybit.com. |
| OKX | yes | no — unified trading account | yes (demo) | Passphrase; demo keys created in demo mode. |
| Coinbase | no | no | no | Advanced Trade; the secret is the EC private key of the CDP key (pasted as is, with or without `\n`). |
| Kraken | no | no | no | Kraken Futures has its own keys, outside this integration. |
| Bitget | yes | yes | no | Passphrase; the account must be one-way (checked before every order). |
| KuCoin | yes | yes | no | Passphrase; a single key (Spot + Futures permissions) serves both markets. |
| Gate.io | yes | yes | yes | No margin mode through the API (leverage only). |
| HTX | yes | no | no | No margin mode through the API. |
| MEXC | read-only | yes | no | MEXC closed futures order placement by API (25/07/2022). |

On Bybit, OKX, KuCoin (and Binance's Funding wallet), a deposit does not land on the trading account but in a separate wallet: "Test" and `ExchangeBalance` read both and say where the funds are; `Transfer` with `from: funding` brings them back to trading (unified account on Bybit).

The PC clock is compensated: ccxt measures the gap with each exchange at opening (and every ten minutes) and dates the requests at *its* time — Binance and Bybit refuse a request dated more than one second after theirs. A refusal of that kind is named as such ("clock skewed by about N s").

### The "+" in the composer

Three actions, and what they really do:

- **Add files** — the chosen files are **dropped into `entrees/` of the agent's
  workspace** (`/api/files/upload`), and the message sent to the model carries their paths:
  the agent reads them with its tools. Nothing is pasted into the prompt, so a CSV of thousands of
  rows stays usable (`Read`, pandas, `Chart`, `Backtest`). **Images** are additionally
  shown to the model: downscaled browser-side (JPEG, 1,600 px on the long side) so as not to bloat
  the thread, which lives in `localStorage`.
- **Take a screenshot** — through the **browser's** screen-sharing API
  (`lib/agent/capture.ts`): you pick the screen or window, a single frame is
  taken, the stream is closed right away. It is downscaled, dropped into `entrees/` and shown to the
  model. *Why not server-side: capturing the screen in PowerShell (`CopyFromScreen`) is the
  exact pattern of infostealers — Windows' antivirus blocks the script
  ("ScriptContainedMaliciousContent").*
- **Deep research** — arms the directive for the next message: the agent follows the
  `recherche-approfondie` skill (break down, search several times differently, go back to the sources,
  cross-check two independent sources, keep the disagreements, date everything).

What is attached shows as chips above the field (removable) then above the message
in the thread.

### The meter, the safety net and permissions

Bottom-right of the thread: **context used / model window**, **tokens per second** during the
answer, and **cost of the turn**. The tooltip details input, output, price and provider. The meter
turns amber at 70 % of the window, red at 90 % — that is the signal for `/compact`. The
data comes from the count OpenRouter puts in the last chunk of the stream (`usage: { include: true }`)
and from the subscription agents' `usage_update` (`lib/agent/usage.ts`, pure and tested).

The loop has a safety net (`lib/agent/resilience.ts`): a transient error (429, 502, dropped
connection) is **retried** up to three times with growing waits, as long as nothing has been
displayed yet; and the same tool call with the same arguments three times in a row is not run a
fourth time — the agent receives a refusal telling it to change approach.

Agents also publish their **plan** and their **reasoning**: the plan shows as a checked list,
the thinking in a folded block. Neither is replayed to the model (`history.ts`).

**"Always" no longer switches the agent to direct execution.** It remembers a rule: the tool
(`Write`) or the start of the command (`Bash(git status *)`) — the button says what it grants, and the
rule is kept in the agent (`allowRules`). An irreversible command (recursive delete,
formatting, `git push --force`, pipe into an interpreter…) has no "Always" button and
asks again every time (`lib/tools/permissions.ts`).

### Compacting a conversation

`/compact` in the composer asks the agent for a structured summary — request, done, decisions,
in progress, not to redo — then **replaces the thread with that summary** (`lib/agent/compact.ts`, pure and
tested). As in Claude Code, everything happens behind the scenes: the thread shows a
"Compacting the thread…" line while the agent writes, then a "Conversation compacted" boundary
behind which the summary stays readable ("view the summary"). Nothing shows up as an
answer. If the compaction fails, a banner says so and offers to retry.
`/compact keep the price levels` adds an instruction to the summary.

Commands are discovered by typing `/`: the list of those that match opens above
the field (`lib/agent/commands.ts`) — ↑↓ to choose, Tab to complete and add instructions,
Enter to run, Esc to close.

The same gesture serves both engines: an agent on OpenRouter finds the summary at the head of its
history (replayed as context, not as one of its answers); a subscription agent sees its
session closed, and the next one starts from the summary instead of the full history.

### Sub-agents

An agent — by key or by subscription — can delegate with the `Workflow` tool: several
independent tasks, three sub-agents at a time, eight at most, and it receives their reports. **Every
sub-agent is one of the four professions** (standard, analyst, strategic, quantitative), nothing
else: the agent picks the profession by the nature of the task and the model by its difficulty
(a light model to collect or format, a strong model to analyse). The sub-agent
gets the prompt and skills of its profession, the same workspace, the same tools
except `Workflow` and anything that commits funds — it reports, it does not act on an account — and
asks no permission: it is the call to `Workflow` that is subject to your approval.

In the thread, the call shows one row per task (profession, title, running / done / failed) that
unfolds onto the returned report. For a key agent, each sub-agent is an OpenRouter loop on the
server (`lib/tools/agents/workflow.ts`); for a subscription agent, `Workflow` is served by the
`bytnode-ai` MCP server and each task opens a **throwaway session of the same agent** — same
subscription, hence same quota — with the requested profession (`lib/mcp/acp-workflow.ts` →
`POST /api/acp/subagent` → `runSubagent` in `lib/acp/sessions.ts`). What is common to both
engines — schema, description, prompt frame, report shape — lives in
`lib/tools/agents/subagent.ts` (pure, tested).

### The data

`Settings` v2 carries `agents: AgentConfig[]` and `activeAgentId`; every `Conversation` carries
its `agentId`. v1 data (a single `agent`, conversations without `agentId`) is migrated on
read under the fixed id `agent-1` (`LEGACY_AGENT_ID`), without rewriting as long as nothing is saved.

### The catalog

OpenRouter publishes no list of vendors: the provider is derived from the id prefix
(`anthropic/claude-sonnet-5`). Two id forms are not new models and are
excluded from "latest releases" while staying searchable: the variants
(`openai/gpt-5:free`, `:batch`, `:thinking`…) and the moving aliases (`~anthropic/claude-opus-latest`).
