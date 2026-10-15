# BytNode-AI — Features

Every feature below exists in the code today. File references point to where it lives; the
technical design is in [architecture.md](architecture.md).

---

## 1. Agents

- **Several agents**, each with: name, profession, provider and default model, default reasoning
  effort, default mode (subscription agents), free-text context and attached context files,
  workspace folder, scope, permission mode, remembered permission rules, allowed exchange
  accounts (`AgentConfig`, `lib/domain/types.ts`).
- **Conversations per agent**: « New agent » on top, then the left column's Agents section (foldable, `+` creates an agent)
  lists the agents, each with « New conversation » and its latest conversations on a thin line, then « Show all »; the icon
  folds them. An agent's name opens its **page** (`agent-page.tsx`): a composer that starts a
  conversation with it, every conversation with its last line and age, and beside them an overview (fact tiles: conversations, last active, 14 days of
  messages) and its instructions and reference files (edited in place) — in the
  plugins' bare-view style. Deleting an agent
  deletes its conversations.
- **Widgets**: the conversation page's header button (Apple's widgets icon, where « Ask before acting »
  was — the mode stays in the composer's settings) opens a menu to add, edit, show or hide widgets:
  excerpts of the plugins — Watchlist, Portfolio, Paper trading, DCA, Calendar, Scheduled tasks,
  Alerts, a position-size calculator — in Apple's three sizes, live, that float along the page's
  borders (never more than 2 cm from one) from the top right, are dragged along them, and scale with
  the window, over a WebGL 2 light tinted by what each says. The conversation keeps two centimetres
  from them on every side: a widget above lowers only what stands under it, one below raises the
  composer, one on a side narrows what is level with it. A widget is carried freely anywhere; let
  go more than 2 cm from a border, it glides back to one by itself, and a small one let go on a small
  one settles right beside it. Two small widgets can stand side by side on a side, never three in a
  row. A right click on a widget offers its sizes, Edit widgets, Hide
  widget and Remove widget; hidden widgets come back from the header menu.
  Settings → Widgets switches each widget on or off, and shows or hides them all. A click opens the plugin's tab. The same widgets, at the same places, in every
  conversation.
- **Floating agent**: on every plugin's tab, a small living companion — a rounded pentagon in
  the app's navy glass, edged in the titles' silver ink, with two eyes, a blue aura and tiny white
  points orbiting it, drawn by a WebGL 2 shader, no disc around it: it breathes, floats, blinks,
  turns toward the pointer, smiles under the hand — opens the last conversation used in a small panel beside it
  (the same thread and engine as the conversations' page), to keep talking to the agent without
  leaving the tab. Dragged anywhere, it sticks to the nearer side; its menu lists any agent's
  conversations to pick one, starts a new one, opens it in full, and resizes by its corners. The avatar is the anchor: docked to any edge, the box stands against it, toward the middle of the screen. Writing,
  its eyes turn blue and a light sweeps across it; a permission waits, they turn amber and it hops; a reply to read, a blue
  dot. Switch in Settings → General.
- **Per-conversation model and effort**, chosen in the model picker; effort levels come from the
  model's published capabilities.
- **Workspace**: a folder per agent, `~/.bytnode-ai/workspaces/<id>` by default or any folder
  picked with the native folder dialog.
- **Scope**: `Workspace only` (file tools refuse outside paths; shell commands naming an outside
  path are refused before they run) or `Whole disk`.

## 2. Model access

### OpenRouter (API key)
- Full OpenRouter catalogue, grouped by vendor, with "latest releases" and search.
  Variants (`:free`, `:thinking`…) and moving aliases (`~…-latest`) are searchable but excluded
  from "latest".
- Reasoning effort per model (`max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`) as
  OpenRouter publishes it.
- **Latency-first provider routing**: every request asks OpenRouter to sort providers by
  latency and to skip `parasail` (configurable by environment variables).

### Subscriptions (ACP)
- **Four vendors**: Claude (Claude Code), OpenAI (Codex), GitHub Copilot (Copilot CLI), Grok
  (Grok Build). Gemini CLI was removed on 2026-10-09: Google forbids third-party apps from using
  its sign-in; an agent saved on it moves to Gemini through OpenRouter.
- **Install / Update** button: the agent is installed into `~/.bytnode-ai/agents/<id>/` on first
  click; Copilot and Grok already on the PATH are recognised. When a new release of
  BytNode-AI raises the supported version, the button becomes "Update".
- **Sign in / Sign out** with the vendor's own login flow (browser or terminal window).
- Vendor models, efforts and modes ("Plan", "Accept edits"…) come from the agent itself.
- API-key environment variables are stripped so the **subscription** is billed, never the API.
- One agent session per conversation, reloaded after a server restart, closed after 15 min idle.

## 3. Tools

| Group | Tools | Permission |
|---|---|---|
| Files | `Read` (text, images, PDF, `.ipynb`), `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep` (ripgrep) | Write/Edit/NotebookEdit gated |
| Shells | `Bash` (Git Bash on Windows), `PowerShell`, `Monitor` (command or WebSocket, ≤ 10 min) | gated |
| Web | `WebSearch` (OpenRouter web plugin), `WebFetch` (HTML → Markdown, 5 MB cap, private addresses refused) | free |
| Finance | `SaveMarketData`, `Chart`, `Backtest`, `Memory` | Backtest gated |
| Organisation | `TodoWrite` (task list shown in the thread), `Skill` (load a method sheet) | free |
| Delegation | `Workflow` (sub-agents) | gated |
| BytNode | `get_system_info`, `get_market_data` (latest values, or history with `since_ms`/`until_ms`), `get_market_indicators` — discovered live over MCP | never gated (read-only) |
| Exchange | see §6 | read free, actions always asked |

Every tool call's arguments are validated against the tool's JSON Schema before permission and
execution; an ill-formed call goes back to the model with the reason, without bothering the user.

### Finance tools in detail
- **SaveMarketData** — runs a BytNode tool and writes the table it returns to a CSV in the
  workspace, returning only a summary: thousands of rows never go through the model.
- **Chart** — PNG chart from a CSV (candles or line, volume, overlaid columns, markers, levels);
  the image is shown in the thread and to the model.
- **Backtest** — standard Python engine (`lib/plugins/finance-tools/py/backtest.py`, needs pandas): the
  agent writes only `signal(df)` / `stop_distance(df)`; the engine handles next-candle execution,
  fees, slippage, funding, risk-based sizing, in/out-of-sample split, per-period and per-year
  metrics, buy-and-hold comparison and equity curve.
- **Memory** — dated notes in `<workspace>/.bytnode-ai/memory.jsonl`; the last 25 are injected
  into every turn's prompt.

## 4. Professions and skills

- **Four professions** (Standard, Analyst, Strategist, Quantitative), each a `PROMPT.md` plus its
  own skills; ten **shared skills** (`source-bytnode`, `reponse-financiere`, `calcul-verifie`,
  `citer-ou-se-taire`, `contradiction-obligatoire`, `conventions-marche`, `horodatage`,
  `recherche-approfondie`, `trading-execution`, `trade-review`).
- **Personal skills**: `~/.bytnode-ai/skills/<name>/SKILL.md`, plus `<workspace>/skills`,
  `<workspace>/.agents/skills` and `~/.agents/skills`. Profession skills win on name collision.
- Skills are listed in the prompt and loaded on demand by the `Skill` tool. Subscription agents
  receive a synchronised copy in their workspace (`.agents/skills/`, `.claude/skills/`);
  hand-written skills there are never overwritten.

## 5. Sub-agents (`Workflow`)

- An agent can split work into independent tasks run by sub-agents: **3 at a time, 8 max**.
- **Every sub-agent is one of the four professions**; the parent picks the profession by the
  nature of the task and the model by its difficulty.
- Sub-agents share the workspace and tools, but get **no `Workflow`** and **no action exchange
  tool** (they report, they never touch funds), and ask no permission — the `Workflow` call
  itself is what the user approves.
- Works for both engines: key agents run sub-agent loops on the server; subscription agents open
  a throwaway session of the same vendor agent per task (same subscription quota).
- The thread shows one row per task (profession, title, running / done / failed) that unfolds to
  its report.

## 6. Exchange trading

- **Accounts** on 10 exchanges: Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate.io,
  HTX, MEXC — API key, secret, passphrase where needed, testnet flag. "Test" connects and reads
  the balance (including the separate funding wallet on Bybit, OKX, KuCoin, Binance).
- Each agent chooses which accounts it may drive. **No account → no exchange tool.**
- **Read tools, no permission**: `ExchangeBalance`, `ExchangePositions`, `ExchangeOrders`,
  `ExchangeTicker`, `ExchangeWatch` (polls up to 10 min, stops on `price>=…`, `pnl<…`, `liq<3%`,
  `closed`).
- **Action tools**: `PlaceOrder` (market, limit, stop, stop-limit, take-profit; size in asset or
  quote; reduce-only; leverage), `CancelOrder`, `ClosePosition` (all or a fraction), `Transfer`
  (spot ↔ futures ↔ funding wallet of the same account), `SetLeverage`.
- **`PlaceOrder`, `ClosePosition` and `Transfer` are always asked**, even in "run directly",
  never have an "Always" button, and carry a red **LIVE** or a **TESTNET** badge.
- **There is no withdrawal tool.**
- Per-exchange limits are known and refused up front with the reason (spot-only Coinbase/Kraken,
  read-only MEXC futures, unified accounts without transfers, no margin mode on Gate/HTX…);
  futures are one-way only, hedge-mode accounts are refused.
- The PC clock is compensated against each exchange (Binance/Bybit refuse requests dated 1 s
  ahead); a clock refusal is reported as "clock skewed by about N s".

## 7. Conversation experience

- **Streaming** answers, smoothed, rendered as Markdown per block.
- **Tool steps** in the thread: arguments, live output lines, result, images, status (pending,
  running, done, failed, denied).
- **Plan and reasoning**: the agent's plan shows as a checklist, its thinking as a folded block;
  neither is replayed to the model.
- **The `+` menu**:
  - *Add files* — dropped into `<workspace>/entrees/`; the model gets their paths (images are
    also shown to it, downscaled to 1,600 px JPEG).
  - *Take a screenshot* — through the browser's screen-sharing API, one frame.
  - *Deep research* — the next message follows the `recherche-approfondie` method.
- **Slash commands**: typing `/` opens a completion list (↑↓, Tab, Enter, Esc).
- **`/compact [instructions]`** — replaces the thread with a structured summary, as a hidden turn
  ("Compacting the thread…"), then a "Conversation compacted" boundary with "view the summary".
- **Automatic context management (OpenRouter)**: at 70 % of the model window, old tool outputs
  are pruned from what the model receives; at 90 % the thread compacts itself at the end of the
  turn; on a provider "context too long" error it compacts and replays the message.
- **Usage meter**: context used / window, tokens per second, cost of the turn, provider;
  amber at 70 %, red at 90 %.
- **Resilience**: transient errors (429, 502, dropped connection) are retried up to three times
  while nothing was displayed; the same tool call repeated three times is refused with a hint to
  change approach; a run is capped at 40 model turns.

## 8. Permissions

- Per agent: **Ask before acting** or **Run directly**, toggleable in the chat header.
- Gated tools in Ask mode: `Bash`, `PowerShell`, `Monitor`, `Write`, `Edit`, `NotebookEdit`,
  `Workflow`, `Backtest`, and the five exchange actions.
- **Allow / Always / Deny**. "Always" stores a precise rule on the agent — a tool (`Write`) or a
  command prefix (`Bash(git status *)`) — instead of switching the agent to direct mode.
- Destructive commands (`rm -rf`, format, `mkfs`, force-push, `curl | sh`…) never offer
  "Always" and never match a rule.

## 9. BytNode integration

- BytNode key checked in settings; BytNode tools discovered at connection time and given to every
  agent (both engines).
- Agents follow the `source-bytnode` method: `get_system_info` first, then `get_market_data`
  (latest values or a history window) and `get_market_indicators`; date every figure; distinguish
  data from inference.
- **Plan-aware guidance** (main agents only): when data is outside the user's plan, the agent
  answers with what it has, then names the first plan that provides it (Free, Traders,
  Financial, Startup, Enterprise) — once, never pushy.

## 10. Local-first data and privacy

- Settings, keys and conversations in `localStorage`; if storage fills up, inline images are
  dropped first (files stay on disk) and a notice is shown — the thread never rolls back.
- Workspaces, installed agents and personal skills in `~/.bytnode-ai/` (`BYTNODE_AI_HOME`).
- The local server refuses cross-site browser requests, so a web page cannot drive
  `localhost:3777`.
- Files served from workspaces are sandboxed (an agent-written SVG cannot run script in the app).

## 11. Distribution

- `npx bytnode-ai` installs a global `bytnode-ai` command, then starts the app; options
  `--port N`, `--no-open`, `--no-install`, `--version`, `--help`.
- The published package is a pre-built Next.js app, checked before publishing for secrets, user
  data and machine paths.
- Continuous integration builds, tests and smoke-tests the package on Linux, macOS and Windows.

## 12. Interface

- BytNode visual identity: animated background, `--ink` / `--paper` / `--voile` tokens,
  Geist / Inter / IBM Plex Mono fonts, light and dark themes.
- Fixed-width, collapsible sidebar; settings panel with General / Auth / Agents / Providers.
