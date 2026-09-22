# BytNode-AI — Product

## In one sentence

BytNode-AI is a **local application that runs AI finance agents on the user's own computer**:
each agent has a trade (a *profession*), real tools (files, shells, web, charts, backtests,
exchange orders) and live crypto market data from **BytNode**, and it runs either on any model
from **OpenRouter** or on the **AI subscription the user already pays for** (Claude, ChatGPT,
Gemini, GitHub Copilot, Grok).

## What problem it solves

A trader, analyst or quant who asks a general chatbot about markets gets answers built from the
model's memory — undated, unverifiable, and frozen at the model's training cutoff. The chatbot
cannot open a CSV, run a backtest, draw a chart or look at an exchange account.

BytNode-AI closes that gap:

| Without | With BytNode-AI |
|---|---|
| Prices "from memory" | Dated, sourced market data from BytNode (prices, derivatives, options, on-chain, ETF flows, macro, sentiment) |
| Advice in prose | Files, CSVs, PNG charts and reproducible Python backtests written in a folder the user owns |
| One generic assistant | Agents specialised by profession: Standard, Analyst, Strategist, Quantitative |
| Copy-paste to the exchange | Balance, positions, orders, and order placement on 10 exchanges — each order confirmed by the user |
| A new paid API key | The user's existing Claude / ChatGPT / Gemini / Copilot / Grok subscription, or an OpenRouter key |

## Who it is for

- **Crypto traders** who want an assistant that reads the market, sizes a position and places
  the order after asking.
- **Analysts** who produce dated market reads, trends and scenarios.
- **Strategists and quants** who design, code and backtest strategies in Python.
- **BytNode customers** — the app is also a showcase and an on-ramp for the BytNode API
  (`bytnode.com`): agents use BytNode as their data source and, when a request needs data outside
  the user's plan, they name the plan that unlocks it.

## How the user gets it

```bash
npx bytnode-ai          # first time: installs the `bytnode-ai` command, then starts the app
bytnode-ai              # every time after that
npx bytnode-ai@latest   # update
```

The app starts a local server on `http://localhost:3777` and opens the browser. Requirements:
Node ≥ 20.9. Optional: Python + pandas (for backtests), `zenity` on Linux (folder picker).
It is published on npm as `bytnode-ai`.

## First launch

A setup wizard opens over the BytNode background:

1. **Profile** — name, e-mail, and a few lines about oneself, passed to every agent.
2. **Authentication** — two tabs:
   - *Subscription*: Claude, OpenAI, Gemini, GitHub Copilot, Grok — "Install" then "Sign in"
     with the vendor's own login (a personal account, never an API key).
   - *Keys*: an OpenRouter key.
   - In both cases: the **BytNode key** (market data) and, optionally, **exchange accounts**.
3. **First agent** — name, provider/model, profession, context (text + files), workspace folder,
   scope (workspace only / whole disk), permission mode (ask / run directly), allowed exchange
   accounts.

Afterwards the left column lists the agents; opening one shows its conversations. Settings
(General / Auth / Agents / Providers) reopen from the cog.

## The two engines

| | **Key agents (OpenRouter)** | **Subscription agents (ACP)** |
|---|---|---|
| Billing | The user's OpenRouter credit | The user's existing subscription quota |
| Models | Any of the OpenRouter catalogue | The vendor's own models (Opus, GPT, Gemini…) |
| Who runs the loop | BytNode-AI itself | The vendor's agent (Claude Code, Codex, Gemini CLI, Copilot CLI, Grok Build), driven through the Agent Client Protocol |
| Tools | BytNode-AI's tool set | The vendor agent's own tools **plus** BytNode-AI's finance, exchange and Workflow tools served over MCP |

Both engines get the same profession prompts, skills, BytNode data and permission prompts.

## The four professions

| Profession | Role |
|---|---|
| **Standard** | Finance and crypto generalist. The right first point of contact. |
| **Analyst** | Reads market data and the macro context; derives trends and scenarios with a confidence level. |
| **Strategist** | Designs complete strategies — objective, entry/exit rules, risk, test plan. Crypto-focused. |
| **Quantitative** | Maths, statistics and Python: models, backtests and implements algorithms with rigour. |

Each profession is a system prompt plus a set of *skills* (method sheets loaded on demand);
another ten skills are shared by all (sourcing, verified calculation, timestamping, trading
execution, trade review…).

## Principles

- **Local first.** The app has no account and no backend of its own. Keys, settings and
  conversations live in the browser's `localStorage`; workspaces, installed agents and personal
  skills live in `~/.bytnode-ai/`. Nothing leaves the machine except the calls to the model
  provider, BytNode and the exchanges.
- **Sourced, dated answers.** Agents are instructed to prefer BytNode over their memory, to date
  every data point, and to say when data is missing rather than invent it.
- **The user keeps control.** Shell commands and file edits can require approval; orders,
  position closes and transfers **always** require approval, even in "run directly" mode, with a
  LIVE / TESTNET badge. There is no withdrawal tool at all.
- **Everything is a file.** Professions, prompts and skills are Markdown files the user can read
  and edit; agents' work lands in a normal folder.

## What it is not

- Not a hosted SaaS: there is no BytNode-AI server, no login, no multi-user mode.
- Not a sandbox: the "workspace only" scope is a path guard on file tools and a text guard on
  shell commands, not an OS-level isolation.
- Not an autonomous trading bot: every order is confirmed by a human.

See [feature.md](feature.md) for the detailed feature list and
[architecture.md](architecture.md) for the technical design.
