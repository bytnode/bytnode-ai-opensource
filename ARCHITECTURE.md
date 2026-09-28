# Architecture

How BytNode-AI is built, where each part lives, and how to work on it.
For what the app protects and what it does not, see [SAFETY.md](SAFETY.md).

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · strict TypeScript · hand-written CSS ·
Vitest. Everything in the repository — code, comments, prompts, skills, docs — is in English.

---

## Contents

1. [The big picture](#the-big-picture)
2. [The agent loop](#the-agent-loop)
3. [Subscription agents (ACP)](#subscription-agents-acp)
4. [Tools](#tools)
5. [Professions and skills](#professions-and-skills)
6. [Plugins](#plugins)
7. [Exchange trading](#exchange-trading)
8. [State and data](#state-and-data)
9. [Packaging](#packaging)
10. [Source layout](#source-layout)
11. [Configuration](#configuration)
12. [Development](#development)

---

## The big picture

```
 browser (localhost:3777)                       local server (Next.js, on the user's machine)
 ────────────────────────                       ──────────────────────────────────────────────
 UI, localStorage (keys, settings,   ── /api ──▶ tool execution, file access, system dialogs,
 conversations), the agent loop                  plugin runtime, ACP sessions
 for key agents                                        │
                                                       ├──▶ OpenRouter (models, by key)
                                                       ├──▶ BytNode MCP server (market data)
                                                       ├──▶ exchanges (ccxt)
                                                       └──▶ subscription agents (subprocesses, ACP)
                                                                 └──▶ local MCP server (our tools)
```

- The app has **no login and no backend of its own**: the Next.js server runs on the user's
  machine, bound to `127.0.0.1`, and every `/api` route acts on that machine.
- **Keys never live on the server's disk.** They sit in the browser's `localStorage` and travel
  with each request (`x-openrouter-key`, `x-bytnode-key`, `x-exchange-accounts` headers).
- **User data never lives in the project.** Workspaces, installed agents, skills and plugin data
  are in `~/.bytnode-ai/` (`lib/server/data-dir.ts`), so an update never touches them.

---

## The agent loop

`lib/agent/loop.ts` — `runAgentLoop(messages, deps)` — is the model → tools → model cycle, up to
40 turns. It is dependency-injected and runs in two places:

| Where | Who | Model through | Tools through |
|---|---|---|---|
| **Browser** | the main agent (`components/chat/use-chat.ts`) | `POST /api/chat` (SSE relay to OpenRouter) | `POST /api/tools/execute` (NDJSON stream) |
| **Server** | `Workflow` sub-agents (`lib/tools/agents/workflow.ts`) | in-process | in-process |

An assistant message keeps its **steps** (text, tool calls with their status, results);
`lib/agent/history.ts` replays them in OpenRouter's format. Reasoning and plans are shown but
never replayed.

**Around the loop**

- **Validation** — tool arguments are checked against the tool's JSON Schema before permission
  and execution (`lib/tools/validate.ts`); a bad call goes back to the model with the reason.
- **Resilience** — `lib/agent/resilience.ts`: transient errors are retried while nothing has been
  shown; the same failing call a third time is refused; a turn that never stops calling tools ends
  with `max_turns`. **Retry** after an interruption resumes the reply in place.
- **Context** — `lib/agent/usage.ts` measures it. At 70 % of the model's window old tool outputs
  are trimmed from what the model receives; at 90 % the thread is compacted; a provider's
  "context too long" refusal triggers a compaction and a replay (`lib/agent/compact.ts`).
  `/compact` does the same on demand, as a hidden turn.
- **System prompt** — `lib/agent/prompt.ts` (the user's profile, the profession, the agent's
  context) + `lib/agent/tools-prompt.ts` (workspace, scope, shell, BytNode status, skills,
  plugins).

**Sub-agents.** `Workflow` splits a request into tasks run three at a time (eight at most). A
sub-agent is always one of the four professions, gets that profession's prompt and skills, every
tool except `Workflow` and the ones that commit funds, and asks no permission — the `Workflow`
call itself is what the user approves. The shared, engine-independent part is
`lib/tools/agents/subagent.ts`.

---

## Subscription agents (ACP)

An agent whose provider is `acp:<id>` does not run our loop: the vendor's own agent runs as a
subprocess, spoken to over the [Agent Client Protocol](https://agentclientprotocol.com)
(JSON-RPC on stdio). Everything is in `lib/acp/`.

| Id | Agent | Package |
|---|---|---|
| `claude` | Claude Code | `@zed-industries/claude-agent-acp` (+ the Claude Agent SDK) |
| `openai` | Codex | `@agentclientprotocol/codex-acp` |
| `gemini` | Gemini CLI | `@google/gemini-cli --acp` |
| `copilot` | Copilot CLI | `@github/copilot --acp` |
| `grok` | Grok Build | `@xai-official/grok agent stdio` |

- **Nothing is bundled.** `packages.ts` says where each agent comes from; **Install** runs npm in
  `~/.bytnode-ai/agents/<id>/` (`install.ts`); an agent already on the PATH is recognised
  (`detect.ts`). `updates.ts` keeps installed agents current within their version range.
- **Launch** — `launch.ts` removes API keys from the environment, starts native binaries directly
  and scripts with Node, and gives each agent a process group so it stops with everything it
  started (`lib/server/process-groups.ts`).
- **Sessions** — `sessions.ts` keeps one ACP session per conversation (15 min idle, reloaded after a
  restart), passes BytNode as an HTTP MCP server and our own tools as a local stdio MCP server
  (`lib/mcp/finance-server.ts`), and syncs the profession's skills into the workspace
  (`skills-sync.ts`).
- **Translation** — `translate.ts` turns ACP updates into the app's events (text, tool calls,
  plans, usage, cards). Permission requests come back through `/api/acp/permission`.
- **Modes** — an agent's own mode picker decides how much it asks; with nothing picked, Codex
  starts in its `read-only` mode (it asks before writes and commands).
- **Money, whatever the mode** — the tool server (`lib/mcp/serve-call.ts`) never runs PlaceOrder,
  ClosePosition or Transfer before BytNode-AI's user has confirmed it: it calls
  `POST /api/acp/confirm`, which raises the prompt on the agent's step in the conversation
  (`confirmCall` in `sessions.ts`: Allow / Deny, LIVE/TESTNET badge, a one-time nonce only the
  browser sees). The agent's own request for these tools is answered once, so the user sees one
  prompt. One turn at a time per conversation (`claimTurn`: a second prompt gets 409).
- **Sign-in** — `auth.ts`: the vendor's CLI when it has one, otherwise the protocol's
  `authenticate` method or a terminal window.

---

## Tools

One file per tool in `lib/tools/`, each implementing:

```ts
Tool { name, description, parameters /* JSON Schema */, policy, execute(args, ctx) }
```

`lib/tools/registry.ts` assembles them — the base set, BytNode's tools discovered over MCP, the
exchange tools when the agent has an account, and the plugins' tools.

| Folder | Tools |
|---|---|
| `fs/` | Read, Write, Edit, NotebookEdit, Glob, Grep (ripgrep) |
| `exec/` | Bash, PowerShell, Monitor — all through `run.ts` (bounded output, timeouts, tree kill) and the shell guard `guard.ts` |
| `web/` | WebSearch (OpenRouter's web plugin), WebFetch (HTML → Markdown, private addresses refused) |
| `agents/` | Workflow |
| `skills/` | Skill |
| `finance/` | Memory |
| `exchange/` | the ten exchange tools |
| `plugins/` | PluginWrite, PluginEdit, PluginCheck, PluginActivate, PluginRead |

**Policy.** Each tool declares `policy: { readOnly, gated, alwaysAsk, subagent }`;
`lib/tools/policy.ts` resolves it over a floor no tool can lower (`names.ts`): orders, position
closes and transfers always ask. `lib/tools/permissions.ts` stores "Always" rules and detects
dangerous commands. `lib/tools/paths.ts` enforces the workspace scope.

---

## Professions and skills

```
professions/
  standard/  analyste/  strategique/  quantitatif/
    PROMPT.md            the profession's system prompt
    skills/<name>/SKILL.md
  _commun/skills/        skills shared by every profession
```

Ids and labels are in `lib/professions/catalog.ts`. A skill is a folder with a `SKILL.md` whose
front-matter has a `name` and a `description` (the line the agent sees to decide when to open it).
The `Skill` tool reads skills from, in order: the profession, the workspace, `~/.bytnode-ai/skills/`
(the user's own) and `~/.agents/skills/`.

> Folder names such as `professions/_commun/`, `analyste/` or `entrees/` are older French names
> kept on purpose: they are paths that existing installs resolve.

---

## Plugins

A plugin adds tools for the agents and, optionally, a tab for the user.

**Built-in plugins** live in `lib/plugins/<id>/`: a `manifest.ts` (what it needs, its views, its
settings) and an `index.ts` (`definePlugin({ manifest, setup(ctx) })`), registered in both
`catalog.ts` (manifests, read by the browser) and `definitions.ts` (setups, server only).

| Plugin | Id |
|---|---|
| Charts and backtests | `finance-tools` |
| Watchlist | `watchlist` |
| Portfolio | `portfolio` |
| Paper trading | `paper-trading` |
| Alerts | `alerts` |
| Recurring purchases | `dca` |
| Scheduled tasks | `scheduler` |
| Calendar | `calendar` |
| Position calculator | `position-calc` |
| Report export | `report-export` |

**Every plugin is independent**: no plugin requires another, and switching one off never switches
off or breaks another (`catalog.test.ts` enforces it). Machinery several plugins use lives in the
core or in `lib/plugins/shared/` — the job clock (`core/clock.ts`, reached through `ctx.job`),
price reading, paper cash — and an integration with another plugin is optional and degrades
gracefully when that plugin is off.

**The runtime** (`lib/plugins/core/`) starts the enabled plugins; a failing plugin is marked in
error and nothing else is affected. `ctx` is a plugin's only way in: tools, prompt
sections, view actions (`/api/plugins/<id>/<action>`, answering 400 / 404 / 503 / 500 by cause),
notifications, confirmations for orders, scheduled jobs, events, optional services, and a store in
`~/.bytnode-ai/plugins/<id>/` (atomic writes, cross-process lock). Two runtimes exist: one in
the Next server (with background work, while a browser tab keeps a session alive) and one per MCP
server (tools only, for subscription agents).

**Views** are React components in `components/plugins/`, shown as tabs by the shell
(`components/shell/`). Open tabs stay mounted; the ones behind are hidden and asleep.

**Plugins written by agents** (`lib/plugins/user/`):

1. The agent writes a draft with `PluginWrite` — `plugin.json`, `server.js`, `tests.js`, `view/*` —
   guided by the `create-plugin` and `plugin-design` skills. A targeted change to an existing file
   goes through `PluginEdit` instead: exact text fragments, applied atomically, no whole-file
   rewrite.
2. `PluginCheck` verifies it inside the app: manifest, code, a dry setup, the plugin's own tests,
   its page.
3. `PluginActivate` asks the user, in the conversation, to approve exactly what the plugin may
   reach. The approval is bound to the code's digest.
4. `server.js` runs in **QuickJS compiled to WebAssembly**, one WebAssembly instance per plugin:
   its memory is capped (the instance's own memory growth is bounded, since QuickJS's limit does
   not count long strings), each call has a CPU budget across its awaits on top of a 2 s slice,
   and a call that overruns its time or budget stops the sandbox (a fresh one starts at the next
   call). Tools and actions can only be registered during setup. It has no `require`, network or
   file access of its own: every call goes through `host-ops.ts`, checked against the grant, and
   its network requests go through the same checked, pinned fetch as WebFetch.
5. Its tab is a sandboxed iframe with the BytNode kit (`lib/plugins/user/kit/`).

On disk: `~/.bytnode-ai/bytnode-plugin-user/<id>/` holds `draft/`, `active/`, `data/`,
`grant.json`.

---

## Exchange trading

`lib/tools/exchange/`, on top of [ccxt](https://github.com/ccxt/ccxt).

- **Accounts** are in the browser settings; each agent picks the ones it may use. They reach the
  server per request and are never written to disk.
- `client.ts` caches one ccxt client per account and market, and syncs the clock with the exchange
  (Binance and Bybit refuse requests dated ahead of theirs).
- `catalog.ts` records each exchange's limits (futures support, transfers, testnet, funding
  wallet), so a call that cannot work is refused before it is made.
- Read tools: balance, positions, orders, ticker, watch. Action tools: place order, cancel, close
  position, transfer, set leverage — **never available to sub-agents, always confirmed**.
- An order, a close or a transfer is **sent once** (`sendOnce` in `common.ts`): if the answer is
  lost after the send, the tool reports an unknown outcome and tells the agent what to check — it
  is never re-sent. Orders carry a client id so they can be found again. Sizes are converted to
  contracts on contract markets (`contractSizeOf`).
- Tests use a fake exchange (`test-fixture.ts`); they never call a real one.

---

## State and data

| What | Where | How |
|---|---|---|
| Settings (agents, keys, plugins) | browser, `agentchat:settings` | versioned (v4), migrated on read (`lib/storage/repositories.ts`) |
| Conversations | browser, `agentchat:conversations` | a full `localStorage` falls back to dropping inline images, never to losing the thread |
| Open tabs, UI habits | browser, `agentchat:tabs`, `agentchat:ui` | |
| Workspaces | `~/.bytnode-ai/workspaces/<id>/` | or a folder the user picks |
| Installed agents | `~/.bytnode-ai/agents/<id>/` | |
| Plugin data | `~/.bytnode-ai/plugins/<id>/`, `~/.bytnode-ai/bytnode-plugin-user/<id>/data/` | atomic writes, cross-process lock (`lib/plugins/core/store.ts`) |

Browser stores are `useSyncExternalStore` stores in `lib/state/`.

---

## Packaging

The app is published on npm as `bytnode-ai`.

- `bin/bytnode-ai.mjs` is the launcher. Run through `npx`, it installs the `bytnode-ai` command
  globally, then starts `next start` on `127.0.0.1` with the package folder as its working directory.
- `prepack` (`scripts/prepack.ts`) builds cleanly, restores the real names of external packages in
  the built chunks, bundles the tool server for subscription agents into `.next/finance-server.mjs`
  (tsx cannot resolve the `@/` aliases of a package installed under `node_modules`;
  `lib/mcp/server-launch.ts` uses the bundle in production, tsx in development), and refuses the
  archive if `lib/publish/pack-check.ts` finds a key, a personal file, the build machine's path, or
  a missing bundle. `npm run smoke:pack` installs the archive and starts that bundle.
- `prepublishOnly` bumps the patch version when the current one is already on npm.
- `package.json` `files` is a whitelist; development output (`.next/dev`, source maps, trace files)
  is excluded.

---

## Source layout

```
app/                 pages and API routes
  api/chat           relay to OpenRouter (SSE)
  api/tools          tool list and execution
  api/acp            subscription agents: auth, models, prompt, permission, sub-agents
  api/plugins        plugin view actions, prompt sections
  api/user-plugins   agent-written plugins: list, view, approve, version
  api/files          serve and upload workspace files
  api/system         native folder picker
components/
  chat/              thread, messages, composer, tool steps
  onboarding/        first-launch wizard
  settings/          settings panel
  shell/             tab bar, notifications, plugin session
  plugins/           the plugins' views
  ui/                shared bricks and icons
lib/
  agent/             loop, prompts, history, compaction, usage, resilience, attachments
  tools/             tools, registry, policy, permissions, validation, paths
  acp/               subscription agents
  mcp/               BytNode client and our local MCP server
  plugins/           runtime, built-in plugins, agent-written plugins
  catalog/           OpenRouter models, providers, efforts
  llm/               OpenRouter client and SSE parsing
  state/  storage/   browser stores and migrations
  server/            data folder, workspaces, origin check, process groups
  publish/           package checks and versioning
professions/         prompts and skills
bin/                 the launcher
scripts/             prepack, smoke test, first-launch helper
proxy.ts             refuses cross-site requests to /api
```

---

## Configuration

All optional, read from the server's environment.

| Variable | Default | Effect |
|---|---|---|
| `BYTNODE_AI_HOME` | `~/.bytnode-ai` | where user data lives |
| `BYTNODE_MCP_URL` | `https://api.bytnode.com/mcp` | BytNode's MCP server |
| `OPENROUTER_BASE_URL` | OpenRouter | another host: a relay, or a fake OpenRouter for tests |
| `OPENROUTER_SEARCH_MODEL` | `deepseek/deepseek-v4.1-flash` | the model behind `WebSearch` |
| `OPENROUTER_PROVIDER_SORT` | `latency` | `latency`, `throughput` or `price` |
| `OPENROUTER_IGNORE_PROVIDERS` | `parasail` | providers to exclude (empty = none) |
| `OPENROUTER_PROVIDER_ORDER` | — | an explicit provider order (wins over the sort) |
| `OPENROUTER_ALLOW_FALLBACKS` | `1` | `0` forbids any other provider |

Provider routing matters: OpenRouter serves one model through several providers, and the same turn
measured 3 s, 34 s or 98 s depending on which one answered (`lib/server/provider-routing.ts`).

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
| `npm test` | Vitest on `lib/` |
| `npx vitest run lib/tools/paths.test.ts` | one test file (`-t "name"` for one test) |
| `npm run build` | production build |
| `npm run smoke:pack` | the package as a user gets it: pack, install in a temp folder, start, query |
| `npm pack --dry-run` | clean build + archive check |
| `npm run vierge` | first-launch state: temporary data, no agent found, fresh port |

**Before a change is done**, `typecheck`, `lint` and `test` must be clean. CI runs them, plus
`smoke:pack`, on Windows, macOS and Linux.

**Conventions**

- Tests sit next to their module in `lib/` (`*.test.ts`, Node environment). Pure logic is split
  into its own module so it can be tested without a browser or a network.
- Never call a real model, BytNode or exchange from a test: use a fake OpenRouter
  (`OPENROUTER_BASE_URL`) or the fake exchange.
- CSS is hand-written next to its component, with BytNode's tokens (`--ink`, `--paper`,
  `--voile`). No Tailwind, no Prettier.
- Commit subjects: `<area>: <summary>` in English (`exchange: …`, `plugins: …`, `docs: …`).
- Anything that starts a process uses `lib/server/process-groups.ts`, so it can be stopped with
  everything it started, on every system.

**Adding things**

- **A tool** — a file in `lib/tools/` and one line in `registry.ts`.
- **A profession** — a folder in `professions/` and an entry in `lib/professions/catalog.ts`.
- **A plugin** — `lib/plugins/<id>/manifest.ts` + `index.ts`, registered in `catalog.ts` and
  `definitions.ts` (`catalog.test.ts` checks both agree).
- **A subscription agent** — an entry in `lib/acp/agents.ts` and one in `lib/acp/packages.ts`.
