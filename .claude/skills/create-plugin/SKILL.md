---
name: create-plugin
description: Open this as soon as the user asks for a new plugin, a new tab, or a tool BytNode-AI does not have ("make me a plugin that…", "I want a page that shows…", "can you add a tool for…") — or asks to change a plugin an agent wrote. The engineering — questions first, then plugin.json, server.js and ctx, permissions, tests, check, activation. For the tab's look, also load plugin-design.
---

# Writing a BytNode-AI plugin for the user

This skill is the engineering. **A plugin with a tab needs a second skill too: `plugin-design`** — load it before writing `view/index.html` (layout, backdrop, centring, the kit, the art direction).

A plugin you write joins the app like the shipped ones: tools for every agent, a tab of its own if the user wants one, background jobs, notifications. It runs in a **closed box**: no file, no network, no keys — only `ctx`, and only what the user **grants** when they review it. You never grant anything yourself.

You work with five tools: `PluginWrite` (one whole file of the draft), `PluginEdit` (targeted replacements inside one file — each one reported and applied best-effort by default; use it to change one thing without rewriting the file), `PluginCheck` (the whole verification), `PluginActivate` (ask for it to run), `PluginRead` (the list, a plugin's state and files — read it before changing an existing one).

## 1. Ask first — one question at a time

Do not write a line before you know what to build. Ask the questions that matter for THIS request, one per message, offering choices when you can. Skip the ones already answered or irrelevant (a calculator needs no question about orders).

1. **What should it do, in one sentence?** What problem does it solve for them?
2. **Where does the data come from?** BytNode (prices, market data), a website or API (which one — you need its exact host), their exchange accounts (read only?), or only what they type?
3. **Should it act on its own over time?** Check every X minutes, warn them when…? (a job + a notification)
4. **Does it need their exchange accounts?** Reading their real portfolio (balances, positions, history), or proposing orders, is possible — never say otherwise. When the request needs it, SAY SO before writing, in plain words: "This plugin needs to read your exchange account (…)" or "…and to propose orders; each one will still wait for your click". Tell them they will choose, at the approval, **Test** (testnet accounts, fake money) or **Real** (their live accounts), and which accounts. The plugin never sees their keys. Ask if they agree. If they say no, build it without the accounts if it still makes sense, or say plainly it cannot be done without.
5. **Do they want a tab?** If yes: what should they see first — a big figure, a curve, a list, a form? What can they do there (add, remove, change a setting)?
6. **Which agents should use it?** (every agent by default)
7. **Any setting they will want to change later?** A threshold, a currency, a frequency — those become `config` entries.

Then **sum it up in a few lines** — what it does, its tools, its tab, and the permissions it will ask for in plain words — and wait for their "yes". Adjust if they correct you.

## 2. Write it

Read the references before writing, every time — the API is small but exact. With the Skill tool: `Skill(name: "create-plugin", file: "reference/ctx.md")`. A subscription agent reads the same files in this skill's folder of its workspace (`.claude/skills/create-plugin/…` or `.agents/skills/create-plugin/…`).

- `Skill(name: "create-plugin", file: "reference/ctx.md")` — plugin.json, `server.js` and `ctx`, `tests.js`, the limits.
- For the tab: **load the `plugin-design` skill** and follow it (the page, the kit, the backdrop veil, the centring, the art direction).
- The closest example, whole: `examples/price-watch/…` (tools + job + notification), `examples/fear-greed/…` (an outside API + a tab with a curve), `examples/rebalance/…` (reads an account, proposes orders). Each has `plugin.json`, `server.js`, `tests.js` and, for the tabs, `view/index.html`.

Write with `PluginWrite`, one file per call, the whole file each time. To change a piece of an existing file, prefer `PluginEdit` (see step 5). The id is short, lowercase, with dashes (`dividend-tracker`). Always write `tests.js`: one test per tool and per action at least, with mocks for anything outside.

## 3. Check it — until everything passes

Run `PluginCheck`. It parses, runs `setup` against a fake world, runs your tests, and looks at the page. Read the report, fix exactly what it names with `PluginWrite` (a whole file) or `PluginEdit` (one fragment), run it again. Do not ask the user to test what the check can tell you.

## 4. Activate it

`PluginActivate`. If it asks for nothing beyond what the user already granted (a new version of the same plugin), it runs at once. Otherwise **the user approves it in a block shown right under your call, in the conversation** — with the Test / Real choice when it uses their exchange accounts. Tell them in one sentence what it will do and what it asks, and that they approve it just below. Never say it is active before `PluginRead` says so.

## 5. Show it, then improve it

Once it is active: if it has a tab, open it with `OpenView` (its view id is the plugin's id, `u-…`) and ask whether it is what they wanted. A change ("add a column", "every hour instead") is steps 2 → 3 again on the same id. For a small change, `PluginRead` the file then `PluginEdit` it (the exact fragments, no whole-file rewrite); for a new file or a deep rework, `PluginWrite` it whole. An approved plugin is updated **live** as soon as the draft passes the check and asks for no new permission — its answer says "LIVE", and the open tab reloads within seconds. If it says "Not live yet", fix what it names (PluginCheck gives the details). A new permission still needs `PluginActivate` and the user's approval in the conversation. If the page or a call failed, `PluginRead` on the plugin shows the recent errors — fix them before they ask.

## Mistakes agents made — do not repeat them

1. **A plugin's files are not files of your workspace.** They live in BytNode-AI's plugin store. Never `Read`, `Edit`, `Write` or a shell on them (you get ENOENT, or you bypass the checks): read them with `PluginRead(plugin, file)`, change them with `PluginEdit` (a targeted fragment — copy the `old` text EXACTLY as `PluginRead` shows it) or `PluginWrite` (a whole file). To change three lines, `PluginEdit` them; to rebuild a file, `PluginWrite` it complete.
2. **A tool's result carries ONE card:** `{ text, facts }` OR `{ text, table }`, never both (only `facts` would show). Put the figures in the table, or the table in the text.
3. **A tool never throws at its caller.** A tool whose `run` throws or returns `{ error }` answers `{ ok: false, output: "…" }` — in `tests.js`, `plugin.tool(…)` resolves and you check `assertEqual(r.ok, false)`. It is an ACTION (`plugin.action(…)`) that rejects: that one you test with `assertThrows`.
4. **Never run `PluginCheck` again without changing something.** After a failure, read the report, fix the file it names with `PluginEdit` or `PluginWrite`, then check again. The same failing call three times in a row, with nothing done between, is stopped as a loop.
5. **Read `reference/ctx.md` before writing** — the return shapes, the test helpers and the limits are there; guessing them costs a round of failed tests.

## What a plugin can never do — say it plainly instead of working around it

- Place, cancel or close an order by itself, move funds, change leverage. It can only **propose** `PlaceOrder`, `ClosePosition` or `Transfer` through `ctx.confirm`: the user clicks each one.
- See an API key, a password, the user's files, or anything outside its own data.
- Call a host it did not declare, or the whole internet. From the page: no network at all — the page asks its plugin with `bn.call`.
- Use an npm library or `import` another file: `server.js` is one self-contained module.
- Run while BytNode-AI is closed: jobs run while a tab of the app is open.

If the request needs one of these, say so and propose what is possible (a proposal to confirm, a notification, a manual step).

## Changing a plugin another agent wrote

`PluginRead` it first (its state, its files), then the same steps. Keep what the user did not ask to change: a small change is one `PluginEdit` on the fragment concerned, not a whole-file rewrite.
