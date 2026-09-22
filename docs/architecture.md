# BytNode-AI — Architecture

Technical specification of the application, component by component. For what the product is
and does, see [product.md](product.md) and [feature.md](feature.md).

---

## 1. Stack and runtime

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, React Compiler lint rules |
| Language | TypeScript strict |
| Styling | Hand-written CSS per area (`app/globals.css`, `components/*/*.css`), BytNode tokens, no Tailwind |
| Tests | Vitest, node environment, `lib/**/*.test.ts` only (no UI tests) |
| Server-only packages | `ccxt`, `@agentclientprotocol/sdk`, `@resvg/resvg-js`, `@vscode/ripgrep`, `pdf-parse`, `turndown` (+ GFM plugin), `fast-glob` — listed in `serverExternalPackages` (`next.config.ts`) |
| Distribution | npm package `bytnode-ai`, launched by `bin/bytnode-ai.mjs` |

The app is **one local Next.js server** (`127.0.0.1:3777`) and a browser tab. There is no
database and no login.

```
┌──────────────────────── browser (localhost:3777) ─────────────────────────┐
│ React UI · stores (localStorage) · agent loop for key agents              │
└───────┬──────────────────────┬───────────────────────────┬────────────────┘
        │ /api/chat (SSE)      │ /api/tools/execute (NDJSON)│ /api/acp/* (NDJSON)
┌───────▼──────────────────────▼───────────────────────────▼────────────────┐
│ Next.js server (proxy.ts guards /api)                                     │
│  OpenRouter relay · tool runtime · ACP session manager · MCP clients      │
└──┬──────────────┬───────────────┬───────────────┬────────────────┬────────┘
   │              │               │               │                │
OpenRouter   BytNode MCP    exchanges (ccxt)   vendor agents      local disk
 (HTTPS)   api.bytnode.com                    (stdio JSON-RPC)   workspaces,
                                               + finance MCP     ~/.bytnode-ai
                                                 server (stdio)
```

## 2. Repository layout

```
app/            pages (layout.tsx, page.tsx) and API routes (app/api/**/route.ts)
bin/            bytnode-ai.mjs — the CLI launcher
components/     React UI: chat/, onboarding/, settings/, ui/, fond/ (background)
lib/
  domain/       shared types (Settings, AgentConfig, Conversation, Message, Model)
  agent/        the agent loop and everything around it (history, prompts, compaction, usage…)
  llm/          OpenRouter client + SSE parser
  tools/        the tool runtime: one file per tool, registry, permissions, validation
  acp/          subscription agents (install, launch, sessions, auth, translation)
  mcp/          BytNode MCP client, local finance MCP server, ACP Workflow bridge
  catalog/      OpenRouter + ACP model catalogue
  state/        useSyncExternalStore stores
  storage/      localStorage abstraction, repositories, migrations
  server/       server-only helpers (OpenRouter, data dir, workspace, origin check, routing)
  professions/  profession catalogue and loader
  publish/      archive check used by prepack
professions/    PROMPT.md + skills per profession, _commun/ shared skills
skills/         README describing the personal-skill format
scripts/        prepack.ts, smoke-pack.mjs, vierge.mjs
types/          ambient type declarations
proxy.ts        Next 16 proxy protecting /api
```

---

## 3. Domain model — `lib/domain/`

`types.ts` is the vocabulary; nothing in it depends on React, the browser or OpenRouter.

- **`Settings`** (version 3): `onboardingDone`, `theme`, `profile`, `authMode`
  (`subscription` | `keys`), `keys: ApiKeys`, `agents: AgentConfig[]`, `activeAgentId`.
- **`ApiKeys`**: `openrouter`, `bytnode`, `exchanges: ExchangeAccount[]`.
- **`ExchangeAccount`**: `id`, `exchange` (ccxt id), `label`, `apiKey`, `secret`, `password`,
  `testnet`.
- **`AgentConfig`**: `id`, `name`, `profession`, `providerId` (OpenRouter vendor prefix or
  `acp:<id>`), `defaultModelId`, `defaultEffort`, `defaultMode`, `contextText`, `contextFiles`,
  `workspace`, `permissionMode` (`ask` | `skip`), `scope` (`workspace` | `disk`), `allowRules`,
  `exchangeAccountIds`.
- **`Conversation`**: `id`, `agentId`, `title`, `modelId`, `effort`, `mode`, `acpSessionId`,
  timestamps, `messages`.
- **`Message`**: `role`, `content`, `steps?` (text / tool / thought / plan…), `usage`,
  `attachments`, `research`, and compaction flags `compaction`, `compactedBy`, `compacting`.
- **`Model`**: catalogue entry with `contextLength`, `variant`, `alias`, `efforts`,
  `defaultEffort`, `reasoningMandatory`.

`conversation.ts` holds pure helpers over conversations (tested).

---

## 4. Persistence — `lib/storage/`, `lib/state/`, `lib/server/data-dir.ts`

**Browser side.** All user state is in `localStorage`:

| Key | Content |
|---|---|
| `agentchat:settings` | `Settings` (profile, keys, agents) |
| `agentchat:conversations` | all conversations |
| `agentchat:ui` | sidebar width / collapsed |

- `storage.ts` — `Storage` interface, `BrowserStorage` / `MemoryStorage`. `set` returns `false`
  when the quota is exceeded.
- `repositories.ts` — typed read/write and **lazy migrations**: v1 (single agent) → v2
  (`agents[]`, legacy id `agent-1`) → v3 (exchange accounts). On a full storage,
  `ConversationsRepository.write` retries without inline image `dataUrl`s, then throws
  `StorageFullError`; the caller keeps the update in memory and shows a notice.
- `lib/state/` — `useSyncExternalStore` stores (`settings.ts`, `conversations.ts`, `ui.ts`,
  generic `store.ts`). New agents get `id: ""` and are stamped at creation in `app/page.tsx`
  (React Compiler forbids random ids in render).

**Disk side.** `data-dir.ts`: `~/.bytnode-ai/` (overridable by `BYTNODE_AI_HOME`) holds
`workspaces/`, `agents/` (installed subscription agents) and `skills/` (personal skills). The
npm package itself is replaced on every version, so no user data may live in it.
`workspace.ts` (`resolveWorkspace`) creates the agent's folder and migrates the legacy in-project
`workspaces/<id>` / `sandboxes/<id>` once.

---

## 5. The agent loop — `lib/agent/`

### 5.1 `loop.ts` — `runAgentLoop(messages, deps)`
The model → tools → model cycle, **dependency-injected** so it runs in two places:

| | Browser (main key agent) | Server (Workflow sub-agent) |
|---|---|---|
| Model | `POST /api/chat` (SSE relay) | OpenRouter directly |
| Tools | `POST /api/tools/execute` (NDJSON) | in-process `execute()` |
| Permissions | UI promise answered by the user | none (auto) |

Per turn: stream the model, reassemble `tool_calls` (`tool-calls.ts`), validate each call's
arguments, ask permission if needed, execute, append results, loop. Maximum **40 turns**; the
last turn is tool-less and the run ends with `finishReason: "max_turns"` if the model still asks
for tools. Events (`events.ts`) — text deltas, tool start/line/result, thought, plan, usage,
retry, sub-agent — drive the UI.

### 5.2 `resilience.ts`
`isTransient` + `backoffDelay`: retry a model turn up to `MAX_ATTEMPTS` **only while nothing has
been emitted** (`{type:"retry"}` shown). `RepetitionGuard`: a third identical tool call is refused
with a message telling the model to change approach.

### 5.3 `history.ts`
`stepsToMessages` replays stored steps in OpenRouter format (thoughts and plans are never
replayed). `pruneToolOutputs(history, { keep, head })` trims old tool outputs under context
pressure. A compaction message is replayed as a `user` message inside
`<previous_thread_summary>`.

### 5.4 Prompts
- `prompt.ts` — `buildSystemPrompt(profile, agent)`: user bio + profession `PROMPT.md` + agent
  context.
- `tools-prompt.ts` — `buildToolsPrompt(...)`: workspace, scope, default shell, BytNode status,
  skill list, exchange section; `subagent=true` variant drops Workflow and makes the exchange
  section read-only.
- `bytnode-guidance.ts` — cross-profession BytNode brief (main agents only).
- Both prompts are assembled **client-side** from what `GET /api/tools` returns.

### 5.5 Context management
- `usage.ts` — `contextEstimate`, `usageState` (`ok` < 70 % ≤ `warn` < 90 % ≤ `full`), tokens/s,
  cost.
- `compact.ts` — `/compact` as a **hidden turn**: `buildCompactRequest` appended to history, reply
  streamed into a `compacting` message, then the thread is replaced by one `compaction` message.
  `isContextOverflow` detects provider refusals (400/413 + wording).
- `use-chat.ts` orchestrates: prune at ≥ 70 %, auto-compact at ≥ 90 % after a clean turn,
  overflow recovery (hard-pruned compaction + replay) once per turn.

### 5.6 Other modules
`commands.ts` (slash-command completion), `attachments.ts` / `attach-client.ts` / `capture.ts`
(uploads, screenshot via `getDisplayMedia`, directives such as deep research).

---

## 6. LLM transport — `lib/llm/`, `lib/server/`, `app/api/chat`

- `lib/llm/client.ts` — `LlmClient.streamChat()`; `completionBody` adds
  `usage: { include: true }` and `provider: PROVIDER_ROUTING`.
- `lib/llm/sse.ts` — SSE parser: text, reasoning, `tool_calls` fragments, final `usage` and
  provider.
- `lib/server/openrouter.ts` / `openrouter-stream.ts` — server relay; the OpenRouter key comes
  from the `x-openrouter-key` request header (never from env).
- `lib/server/provider-routing.ts` — `sort: "latency"`, `ignore: ["parasail"]` by default;
  `OPENROUTER_PROVIDER_SORT`, `OPENROUTER_IGNORE_PROVIDERS`, `OPENROUTER_PROVIDER_ORDER`,
  `OPENROUTER_ALLOW_FALLBACKS`.
- `OPENROUTER_BASE_URL` redirects everything to a relay or a fake OpenRouter.

---

## 7. Tool runtime — `lib/tools/`

### 7.1 Contract
```ts
Tool { name, description, parameters /* JSON Schema */, execute(args, ctx) }
```
`ToolContext`: `workspace`, `scope`, `projectRoot`, `signal`, `emit` (stream lines / events),
`depth`, `llm`, `callId`, `professionSkills`, `bytnodeKey`, `exchangeAccounts`.

### 7.2 Assembly
- `registry.ts` — `baseTools({platform})` and `allTools({platform, bytnodeKey,
  exchangeAccounts})` = base + BytNode MCP tools discovered live + exchange tools **only if the
  agent has at least one account**.
- `names.ts` — `GATED_TOOLS`, `ALWAYS_ASK` (`PlaceOrder`, `ClosePosition`, `Transfer`),
  `allowedForSubagent` (no Workflow, no action exchange tools).
- `validate.ts` — dependency-free JSON Schema check (`type`, `required`, `enum`, `items`,
  `minimum`, `maximum`, `pattern`, `additionalProperties`) before permission and execution.
- `permissions.ts` — `ruleFor`, `matchesRule` for `allowRules`; `isDangerous` blocks "Always".
- `client.ts` — browser view: fetch specs, execute through the route, send the
  `x-exchange-accounts` header.

### 7.3 Safety
- `paths.ts` — `resolvePath(workspace, p, scope)` throws `OutsideWorkspaceError`.
- `exec/guard.ts` — refuses a shell command whose **text** references a path outside the
  workspace (drive roots, UNC, `${env:X}`, location variables…). A text guard, not a sandbox.
- Resource bounds: `exec/run.ts` keeps ≤ 200 kB and caps lines at 1 MB; `Read` ≤ 50 MB text;
  `WebFetch` ≤ 5 MB / 100 k chars and refuses private addresses; `Grep` 60 s; `Monitor` /
  `ExchangeWatch` ≤ 10 min.

### 7.4 Tool families
| Folder | Tools | Notes |
|---|---|---|
| `fs/` | Read, Write, Edit, NotebookEdit, Glob, Grep | Read handles text, images, PDF (`pdf-parse` v2), notebooks; Grep uses bundled ripgrep |
| `exec/` | Bash, PowerShell, Monitor | Git Bash on Windows; bounded spawn |
| `web/` | WebSearch, WebFetch | search via OpenRouter web plugin (`OPENROUTER_SEARCH_MODEL`); fetch via turndown + GFM |
| `finance/` | SaveMarketData, Chart, Backtest, Memory | `csv.ts` and `svg.ts` are pure and tested; Chart renders SVG → PNG with resvg; Backtest spawns `py/backtest.py` |
| `skills/` | Skill | reads skill roots (§10) |
| `agents/` | Workflow | §9 |
| `exchange/` | 10 exchange tools | §8 |
| root | TodoWrite | emitted as a `plan` event, never replayed |

---

## 8. Exchange trading — `lib/tools/exchange/`

- **Transport of keys**: accounts live in browser settings; only the agent's allowed accounts
  travel, per request, in the `x-exchange-accounts` header (URI-encoded JSON), in the
  `/api/acp/prompt` body, and to the finance MCP server via `BYTNODE_AI_EXCHANGE_ACCOUNTS`. Never
  written to disk, never logged.
- `client.ts` — `clientFor(account, market)`: one cached ccxt instance per
  sha256(account × market); only ids in `ccxt.exchanges` are instantiated; `defaultType: swap`
  for futures, `setSandboxMode` for testnet; **clock sync** (`loadTimeDifference` before
  `loadMarkets`, then every 10 min) with `adjustForTimeDifference` and `recvWindow: 10_000`.
- `common.ts` — `resolve`, `symbolOn`, `attempt`, `hedgeModeError` (one-way futures only).
- `catalog.ts` — per-exchange capabilities: `futures: full | read | none`, `futuresId`,
  `transfer`, `funding` wallet, `note`.
- `symbols.ts` (normalisation), `errors.ts` (ccxt error → plain English, one retry on
  transient, clock-skew naming), `format.ts`, `watch-until.ts` (stop-condition grammar),
  `prompt.ts` (`exchangePromptSection`), `accounts.ts` (`allowedAccounts`, header codec).
- Tests mock `./client` with a fake exchange (`test-fixture.ts`); no test ever calls a real
  exchange.

---

## 9. Sub-agents — `Workflow`

- `lib/tools/agents/subagent.ts` (pure, tested) — the shared contract: `workflowParameters`
  (`tasks[].profession` required enum, `tasks[].model`), `readTasks`, `runInPool` (3 concurrent,
  8 max), `subagentFrame` (profession prompt + "one task, one report, no delegation, no funds"),
  `reportSection`, `parseWorkflowReport`.
- **Key agents** — `workflow.ts` runs `runAgentLoop` server-side per task and emits `subagent`
  events (profession, final report).
- **Subscription agents** — `lib/mcp/finance-server.ts` exposes `Workflow` only at depth 0;
  `lib/mcp/acp-workflow.ts` posts each task to `POST /api/acp/subagent` (NDJSON, `tick` every
  15 s, then `done` / `error`) with a per-conversation token; `runSubagent` (`lib/acp/sessions.ts`)
  requires the parent session to be live and busy, opens a throwaway session of the same agent
  in the same workspace at depth 1, auto-allows permissions except always-ask titles, collects
  the streamed text as the report, 10 min timeout.
- UI — `WorkflowView` in `components/chat/tool-step.tsx`.

---

## 10. Professions and skills — `professions/`, `lib/professions/`, `lib/tools/skills/`

- `lib/professions/catalog.ts` — `PROFESSIONS` (ids `standard`, `analyste`, `strategique`,
  `quantitatif`; English labels), shared with the browser. `load.ts` (server) reads
  `professions/<id>/PROMPT.md` and `professions/<id>/skills/*/SKILL.md` +
  `professions/_commun/skills/`.
- Skill file = Markdown with YAML front-matter (`name`, `description`), loaded on demand by the
  `Skill` tool.
- Lookup order (`skill.ts`): profession skills first, then `<workspace>/.agents/skills`,
  `<workspace>/skills`, `~/.bytnode-ai/skills`, `~/.agents/skills`.
- `lib/acp/skills-sync.ts` — copies profession + user skills into the workspace's
  `.agents/skills/` and `.claude/skills/` for ACP agents (marked, idempotent, prunes removed
  ones, never overwrites hand-written ones; sub-agents sync the union of all professions under a
  lock).
- Adding a profession = a folder + an entry in `PROFESSIONS`.

---

## 11. Subscription agents (ACP) — `lib/acp/`

| Module | Responsibility |
|---|---|
| `agents.ts` | `ACP_AGENTS` catalogue (claude, openai, gemini, copilot, grok), shared with the browser |
| `packages.ts` | `AGENT_SOURCES`: npm package, version range, `overrides`, ACP entry and args per agent (pure, tested) |
| `install.ts` | writes `~/.bytnode-ai/agents/<id>/package.json` and runs the npm CLI bundled with the running Node |
| `detect.ts` | `findOnPath` (PATHEXT-aware; resolves Windows `.cmd` shims back to the JS entry) |
| `launch.ts` | `resolveAcp` (installed → PATH), spawns with API-key env vars stripped; `claudeCli()` finds the Claude Agent SDK native binary; `openTerminal` for login flows |
| `connection.ts` | JSON-RPC over stdio via `@agentclientprotocol/sdk`; drops stray string-id responses; image blocks gated on `promptCapabilities.image` |
| `sessions.ts` | one session per conversation (key includes `toolsVersion()`), 15 min idle TTL, `session/load` after restart, `applyConfig` (model / effort / mode through `session/set_config_option`), MCP servers (BytNode HTTP + finance stdio), permission relay, `runSubagent` |
| `translate.ts` | `session/update` → `WireEvent` (text, thought, plan, tool calls, usage) — pure, tested |
| `auth.ts` | login state: dedicated CLI for claude/openai/gemini, otherwise a probe session (cached 90 s, 45 s timeout); first read returns `checking: true` and fills in the background |
| `models.ts` | models/efforts/modes from the agent's session config options (cached) |
| `prompt.ts` | `buildAcpPrompt` — the BytNode-AI prompt for external agents |
| `prepare.ts` | workspace preparation (Claude: `.claude/settings.local.json` with a known `permissions.defaultMode`) |
| `client.ts`, `use-auth.ts`, `wire.ts` | browser-side client, auth store, wire types |

**Claude specifics**: the model list comes from the Claude Agent SDK embedded in
`@zed-industries/claude-agent-acp`; `AGENT_SOURCES.claude.overrides` forces a recent SDK
(bump it there when new models ship). The adapter ignores the model passed at `session/new`, so
`applyConfig` corrects it before the first prompt.

**Routes**: `/api/acp/auth` (status, login, logout, install, uninstall), `/api/acp/models`,
`/api/acp/prompt` (NDJSON stream of `WireEvent`s), `/api/acp/permission`, `/api/acp/cancel`,
`/api/acp/subagent`.

---

## 12. MCP — `lib/mcp/`

- `bytnode.ts` — StreamableHTTP client to `https://api.bytnode.com/mcp` (`BYTNODE_MCP_URL`),
  `X-API-KEY` header, one cached session per key; `checkBytnodeKey` behind
  `GET /api/bytnode/key`. Its tools are discovered and exposed read-only to every agent.
- `finance-server.ts` — local **stdio MCP server** (run with `tsx`) that gives ACP agents
  BytNode-AI's own tools: finance tools, exchange tools (actions dropped at depth ≥ 1) and
  `Workflow` (depth 0 only). Configured by env: `BYTNODE_AI_WORKSPACE`,
  `BYTNODE_AI_BYTNODE_KEY`, `BYTNODE_AI_EXCHANGE_ACCOUNTS`, `BYTNODE_AI_DEPTH`,
  `BYTNODE_AI_PARENT`, `BYTNODE_AI_ACP_AGENT`, `BYTNODE_AI_ORIGIN`,
  `BYTNODE_AI_SUBAGENT_TOKEN`. Arguments validated recursively with `validateArgs`.
- `acp-workflow.ts` — the ACP side of `Workflow` (§9).

---

## 13. Model catalogue — `lib/catalog/`

- `catalog.ts` — OpenRouter models → `Model`/`Provider`; provider derived from the id prefix;
  variants and aliases excluded from "latest"; `effortOptions()` (appends `none` unless reasoning
  is mandatory) — the only valid way to validate an effort.
- `use-catalog.ts` — browser store merging OpenRouter models with ACP models (`acp:` ids);
  `loadAcpModels` queues and replays reloads requested during a cold 15–55 s load;
  `Catalog.acpLoading` lets the picker say "loading".
- Route: `GET /api/openrouter/models` (1 h cache, no key required), `GET /api/openrouter/key`.

---

## 14. API routes — `app/api/`

| Route | Method | Role |
|---|---|---|
| `chat` | POST | OpenRouter completion relay (SSE) |
| `tools` | GET | resolved workspace, tool specs, skills, BytNode status |
| `tools/execute` | POST | run one tool, NDJSON stream (lines, sub-agent events, result) |
| `files` | GET | serve a workspace file (`nosniff`, `CSP: sandbox`) |
| `files/upload` | POST | attachments → `<workspace>/entrees/` |
| `memory` | GET | last Memory notes for the prompt |
| `openrouter/models`, `openrouter/key` | GET | catalogue, key check |
| `bytnode/key` | GET | BytNode key check |
| `exchange/check` | POST | connect an exchange account, read balances incl. funding wallet |
| `system/pick-folder` | POST | native folder dialog (initial dir passed via env, never interpolated) |
| `acp/*` | — | §11 |

### Local-server security — `proxy.ts`, `lib/server/origin.ts`
The app has no login and every route acts on the machine. `proxy.ts` (matcher `/api/:path*`)
refuses requests whose `Sec-Fetch-Site` is not `same-origin`/`none` or whose `Origin` does not
match `Host`, so a web page cannot POST to `localhost:3777`. Non-browser clients send neither
header and pass.

---

## 15. User interface — `components/`, `app/`

- `app/page.tsx` — wizard overlay until onboarding is done, then `ChatShell`; stamps new agent ids.
- **`chat/`**
  - `chat-shell.tsx` — layout, header (permission toggle, TESTNET badge), notices (storage full,
    compaction error with Retry), settings target.
  - `use-chat.ts` — the conversation controller: engine choice (`acpAgentOf(providerId)`),
    `send` / inner `turn`, streaming smoothing (rAF reserve/reveal), permission promises,
    context management, attachments/prompt substitution.
  - `thread.tsx`, `message.tsx` (steps, thoughts, plans, `CompactionView`), `markdown.tsx`
    (memoised per block), `tool-step.tsx` (tool rows, permission prompt, `ExchangeBadge`,
    `WorkflowView`), `composer.tsx` (`+` menu, slash completion), `model-picker.tsx`,
    `sidebar.tsx`, `usage-meter.tsx`.
- **`onboarding/`** — `wizard.tsx` (first launch only), `step-profil.tsx`, `step-auth.tsx`
  (exports `KeyField`, `OpenRouterKey`, `BytnodeKey`, `Subscriptions` reused by settings),
  `step-agent.tsx`, `provider-picker.tsx`, `context-files.tsx`, `folder-field.tsx`,
  `exchange-accounts.tsx`.
- **`settings/settings-panel.tsx`** — General / Auth / Agents / Providers; fields save
  immediately through `updateSettings`; only the agent form has a submit button.
- **`ui/`** — shared primitives (`Field`, `Select`, `SearchPanel`, `ConfirmDialog`,
  `ThemeToggle`, icons). **`fond/`** — the animated BytNode background.

---

## 16. Packaging and distribution

- `bin/bytnode-ai.mjs` — plain Node, no dependency: checks Node ≥ 20.9, finds a port, runs
  `next start` **with `cwd` = the package directory** (so `PROJECT_ROOT = process.cwd()` holds),
  waits for the server, opens the browser. Run from the `_npx` cache it first installs the
  global command (`npm install -g bytnode-ai@<same version>`).
- `package.json` `files` whitelist: `bin`, `.next`, `lib` (minus tests), `professions`, `types`,
  config files.
- `scripts/prepack.ts` — clean `next build`, drops `.next/cache`, rewrites Turbopack's hashed
  `serverExternalPackages` aliases, blanks the machine path in `required-server-files.json`,
  and refuses the archive if `lib/publish/pack-check.ts` finds `.env*`, `workspaces/`,
  `sandboxes/`, `.mcp.json`, a `cb_live_` / `sk-or-v1-` key or an absolute path of the build
  machine.
- `scripts/smoke-pack.mjs` — pack, install the tarball in a temp dir, start, `GET /api/tools`.
- `scripts/vierge.mjs` — first-launch simulation (temp data dir, PATH agents ignored, random
  port = empty `localStorage`).
- `.github/workflows/pack.yml` — typecheck, tests and smoke-pack on Ubuntu, macOS, Windows.

---

## 17. Configuration reference

| Variable | Side | Effect |
|---|---|---|
| `BYTNODE_AI_HOME` | server | data directory (default `~/.bytnode-ai`) |
| `OPENROUTER_BASE_URL` | server | redirect OpenRouter calls |
| `OPENROUTER_SEARCH_MODEL` | server | model used by WebSearch |
| `OPENROUTER_PROVIDER_SORT` / `_IGNORE_PROVIDERS` / `_PROVIDER_ORDER` / `_ALLOW_FALLBACKS` | server | provider routing |
| `BYTNODE_MCP_URL` | server | BytNode MCP endpoint |
| `BYTNODE_AI_IGNORE_PATH` | server | ignore PATH-installed agents (used by `vierge`) |

Keys are **not** configured by environment: the OpenRouter key, BytNode key and exchange
accounts come from the browser per request (`x-openrouter-key`, `x-bytnode-key`,
`x-exchange-accounts`).

---

## 18. Testing

- Unit tests sit next to their module in `lib/` (Vitest, node env). Covered: agent loop, SSE,
  history, compaction, usage, resilience, validation, permissions, paths, shell guard,
  edit/notebook logic, catalogue, storage migrations, professions, ACP translation / packages /
  detection, exchange pure modules and mocked tools, pack check.
- `npm run typecheck`, `npm run lint`, `npm test` must be clean before a change is done.
- End-to-end checks use throwaway scripts against a fake OpenRouter (`OPENROUTER_BASE_URL`) or
  an exchange testnet; `.probe-acp.mjs` is a token-free ACP handshake probe.
