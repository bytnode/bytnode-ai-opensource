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
10. [The desktop app](#the-desktop-app)
11. [Source layout](#source-layout)
12. [Configuration](#configuration)
13. [Development](#development)

---

## The big picture

```
 browser (localhost:3777)                       local server (Next.js, on the user's machine)
 ────────────────────────                       ──────────────────────────────────────────────
 UI, localStorage (keys, settings,   ── /api ──▶ tool execution, file access, system dialogs,
 conversations), the agent loop                  plugin runtime, ACP sessions
 for key agents                                        │
                                                       ├──▶ OpenRouter (models, by key)
                                                       ├──▶ BytNode MCP server (the AI agents' market data)
                                                       ├──▶ BytNode REST API + WebSocket (the app's market data)
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

**BytNode: two readers, two roads** (2026-10-11). The AI agents read BytNode through its MCP
server (`lib/mcp/bytnode.ts`). Everything else — a plugin's view, its background jobs, the
widgets, the key check — reads its REST API (`lib/bytnode/rest.ts`: candles, funding, the pairs,
the snapshot, indicators) and, for live prices, its WebSocket (`lib/bytnode/live.ts`: ONE
connection per key in the Next server, the `trades.spot.<SYM>` channels, the pairs held while
something wants them and let go a minute after). A plugin's tool runs the same code as its view,
so the runtime marks a tool's execution as an agent's (`asAgent`, `lib/bytnode/reader.ts`) and the
price layer (`lib/plugins/shared/prices.ts`) picks its road from that mark. There is no ticker on
the WebSocket: the live price is the last trade, and the changes over 1 h / 4 h / 24 h / 7 d are
worked out against a `/v1/price-change` reading taken every ten minutes. A view gets its prices
pushed (`/api/market/live`, NDJSON, `components/plugins/use-live-quotes.ts`) instead of reading
them again and again; a WebSocket refused at the handshake (a plan without live access) is told in
plain English and the prices fall back on that REST reading. Plugins written by agents call
`ctx.bytnode("/v1/…", params)` (REST); the older form with an MCP tool's name still works.

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

The build itself (clean `next build`, external names restored, finance server bundled, this
machine's path blanked) is `scripts/release-build.ts`, shared with the desktop app.

---

## The desktop app

The same app in its own window, installed like any desktop program (Electron). Nothing in the app
changes: the window shows the same Next server the `bytnode-ai` command starts, on the same
`~/.bytnode-ai` data folder.

```
BytNode-AI (Electron main process, desktop/main.ts)
  ├─ starts:  BytNode-AI.exe as Node (ELECTRON_RUN_AS_NODE=1) → next start, 127.0.0.1:<free port>
  └─ shows:   a window on http://127.0.0.1:23777  ──(Chromium --host-rules)──▶ the real port
```

- **One binary.** The app ships no Node: its Electron binary is one when `ELECTRON_RUN_AS_NODE=1`
  is set (`desktop/server.ts`). The server gets it, and so does every process it starts with
  `process.execPath` (a subscription agent's script, the finance MCP server, npm), which inherit
  it; `lib/acp/sessions.ts` also puts it in the MCP server's environment, and
  `posixTerminalLine` in a sign-in terminal's line.
- **A fixed origin** (`desktop/window-origin.ts`). Everything the app keeps (keys, agents,
  conversations) is in `localStorage`, which belongs to an origin, port included. The server
  takes a free port at each launch; the window always uses `127.0.0.1:23777`, mapped to it by a
  Chromium switch set before the app is ready. The server accepts that Host
  (`BYTNODE_AI_WINDOW_PORT`, `proxy.ts`) and gives its children its real address
  (`BYTNODE_AI_SELF_ORIGIN`, `selfOrigin`). A custom scheme answered by the main process was
  tried first and dropped: through it, a request the window abandoned kept running on the server
  (Stop did not stop a command).
- **No Node on the machine.** Installing a subscription agent needs npm, and npm's install
  scripts need a `node`: the build copies npm beside the app (`scripts/desktop-after-pack.cjs`,
  passed as `BYTNODE_AI_NPM_CLI`, read first by `npmCli`), and the server's PATH ends with a
  `node` shim running the app's binary (`desktop/node-shim.ts`); a Node the user installed comes
  first.
- **No console windows** (Windows). The app's binary is a windowed program with no console: a
  console program an agent's own code starts from it without `windowsHide` got a terminal window
  of its own, on screen (Codex's `codex.js` → `codex.exe`, at every status check). Every Node the
  app runs loads `desktop/hide-windows.cjs` first (`NODE_OPTIONS=--require`), which makes hidden
  the default for `child_process`.
- **The user's PATH.** Started from the Dock or a desktop menu, macOS and Linux give an app a bare
  PATH; the main process asks the user's login shell for its own (`desktop/shell-path.ts`).
- **What the browser gave.** Links to the web open in the user's browser, the app's own files
  in a window of their own, anything else is refused (`linkTarget`); screen capture
  (`setDisplayMediaRequestHandler`), notifications, the text right-click menu, the application
  menu (macOS needs it for copy and paste), the window's size and place (`window-state.ts`), one
  copy at a time (a second would run the scheduler twice).
- **No system title bar** (`desktop/frame.ts`): the app's tab bar is the title bar, as in Edge.
  The window's buttons are drawn over its right end (a transparent window controls overlay, their
  ink following the page's theme through the preload, `desktop/preload.ts`) or the traffic lights
  at its left (macOS); its empty parts move the window. These rules are injected by the main
  process (`insertCSS`), the web app is unchanged; everything inside the bar is `no-drag`, or its
  clicks would be swallowed.
- **The keys in the system's vault** (`desktop/vault.ts`): the OpenRouter and BytNode keys and the
  exchange accounts' secrets never reach the window's plain storage. `SettingsRepository` takes an
  optional vault (`lib/storage/secrets.ts`): it writes the settings without them and puts them back
  on reading; the preload hands the page `bytnodeVault` (synchronous), and the main process encrypts
  them with safeStorage (DPAPI, Keychain, libsecret) into `secrets.vault` in the profile. Keys left
  in plain storage by an older version move in at the next read; no real vault (Linux without a
  keyring) = as in the browser.
- **The BytNode account** (`desktop/account.ts`, pure part `desktop/account-flow.ts`, page side
  `lib/account/account.ts`): the desktop app opens on a sign-in page (`components/account/
  sign-in-screen.tsx`) until it is signed in. « Sign in with the browser » opens
  `bytnode.com/auth/desktop?challenge&port&state` (PKCE S256 + a loopback listener on 127.0.0.1,
  RFC 8252 — no URL scheme); the page, signed in there, confirms with one click and sends a one-time
  code back to `http://127.0.0.1:<port>/callback`; the main process exchanges it
  (`POST /api/auth/desktop/token`) for a session of its own (`bnd_…`, revocable), kept encrypted in
  `account.vault` in the profile and never handed to the page. Then, before the app opens: a BytNode
  key made for it when there is none (`POST /api/desktop/api-key`, « BytNode-AI desktop »), the
  profile filled where empty. Signed in = a session is stored, so the app opens offline; online, it
  is checked at start (`GET /api/desktop/me`, 401 → back to the sign-in page). Settings → General →
  « BytNode account » signs out (the session is revoked, local data stays). The server side is
  `app_web` (`backend/src/modules/desktop-auth`, `frontend/app/auth/desktop`). The npm app has no
  bridge and no sign-in page.
- **From zero** (`desktop/fresh.ts`): `BytNode-AI --fresh`, or File → Start Over from Zero, opens
  the app as a new user gets it — a new browser profile, a new data folder, an empty home for the
  server and the agents it starts (so Claude, Codex… show signed out), the PATH's agents ignored,
  no updates — without touching the real setup. Sessions live in the temp folder; the previous ones
  are removed at the next start.
- **Updates** (`desktop/updates.ts`, electron-updater): the packaged app reads
  `https://ai.bytnode.com/download/desktop/latest*.yml` at start and every six hours, downloads in
  the background and offers to restart. macOS refuses to swap an app that has no Developer ID
  signature: there, the check fails quietly.

**Building.** `npm run desktop:dist` = the release build + the main process bundled
(`dist-desktop/app/main.cjs`) + the icon rendered from `desktop/resources/icon.svg` +
`next.config.ts` compiled to `next.config.mjs` (read as TypeScript, `next start` needs SWC, which
the installer leaves out with sharp, source maps and Next's development runtimes), then
electron-builder (`electron-builder.yml`, no asar: the server reads its own files and hands paths
to child processes). The result is checked like the npm archive (no key, no personal file, no path
of the build machine, nothing missing) and deleted if it fails. An installer is built on its own
system; the `desktop` workflow builds Windows, macOS (Apple Silicon and Intel, two runners) and
Linux, by hand or on a `desktop-v*` tag, and leaves one `desktop-release` artifact with the
macOS update files merged (`scripts/desktop-merge-yml.mjs`). Nothing is published by a build:
the files are put online by hand, under `/download/desktop/` (their names carry no version, so
the download page links to them for good). Without a certificate, Windows installers are
unsigned and macOS apps are signed ad hoc; `CSC_LINK` / `APPLE_ID`… turn real signing and
notarization on.

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
desktop/             the desktop app's main process (Electron)
scripts/             release build, prepack, desktop build, smoke test, first-launch helper
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

The desktop app also reads `BYTNODE_AI_NO_UPDATES=1` (no update check), `BYTNODE_AI_DESKTOP_PROFILE`
(another browser profile folder) and, in development, `BYTNODE_AI_DESKTOP_URL` (show a running
server instead of starting one), `BYTNODE_AI_ACCOUNT_URL` / `BYTNODE_AI_ACCOUNT_API` (sign in
against a local app_web, e.g. `http://localhost:3000` / `http://localhost:4000/api`, instead of
bytnode.com). It sets `BYTNODE_AI_WINDOW_PORT`, `BYTNODE_AI_SELF_ORIGIN` and
`BYTNODE_AI_NPM_CLI` for its server.

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
| `npm test` | Vitest on `lib/` and `desktop/` |
| `npx vitest run lib/tools/paths.test.ts` | one test file (`-t "name"` for one test) |
| `npm run build` | production build |
| `npm run smoke:pack` | the package as a user gets it: pack, install in a temp folder, start, query |
| `npm pack --dry-run` | clean build + archive check |
| `npm run vierge` | first-launch state: temporary data, no agent found, fresh port |
| `npm run desktop` | the desktop app on the last `npm run build` (`-- --dev-url http://127.0.0.1:3777` on a running `npm run dev`) |
| `npm run desktop:dir` | desktop release build, unpacked (`dist-desktop/release/*-unpacked`) |
| `npm run desktop:dist` | desktop release build + this system's installers |

**Before a change is done**, `typecheck`, `lint` and `test` must be clean. CI runs them, plus
`smoke:pack`, on Windows, macOS and Linux.

**Conventions**

- Tests sit next to their module in `lib/` and `desktop/` (`*.test.ts`, Node environment). Pure logic is split
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
