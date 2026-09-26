---
name: create-plugin
description: Open this as soon as the user asks for a new plugin, a new tab, or a tool BytNode-AI does not have ("make me a plugin that…", "I want a page that shows…", "can you add a tool for…") — or asks to change a plugin an agent wrote. The method (questions first, then write, check, activate), the ctx API, the page kit and the art direction.
---

# Writing a BytNode-AI plugin for the user

A plugin you write joins the app like the shipped ones: tools for every agent, a tab of its own if the user wants one, background jobs, notifications. It runs in a **closed box**: no file, no network, no keys — only `ctx`, and only what the user **grants** when they review it. You never grant anything yourself.

You work with four tools: `PluginWrite` (one file of the draft), `PluginCheck` (the whole verification), `PluginActivate` (ask for it to run), `PluginRead` (the list, a plugin's state and files — read it before changing an existing one).

## 1. Ask first — one question at a time

Do not write a line before you know what to build. Ask the questions that matter for THIS request, one per message, offering choices when you can. Skip the ones already answered or irrelevant (a calculator needs no question about orders).

1. **What should it do, in one sentence?** What problem does it solve for them?
2. **Where does the data come from?** BytNode (prices, market data), a website or API (which one — you need its exact host), their exchange accounts (read only?), or only what they type?
3. **Should it act on its own over time?** Check every X minutes, warn them when…? (a job + a notification)
4. **Should it propose orders?** If yes: which ones, on what condition, on a real or testnet account? Each order will wait for their click — say so.
5. **Do they want a tab?** If yes: what should they see first — a big figure, a curve, a list, a form? What can they do there (add, remove, change a setting)?
6. **Which agents should use it?** (every agent by default)
7. **Any setting they will want to change later?** A threshold, a currency, a frequency — those become `config` entries.

Then **sum it up in a few lines** — what it does, its tools, its tab, and the permissions it will ask for in plain words — and wait for their "yes". Adjust if they correct you.

## 2. Write it

Read the references before writing, every time — the API is small but exact. With the Skill tool: `Skill(name: "create-plugin", file: "reference/ctx.md")`. A subscription agent reads the same files in this skill's folder of its workspace (`.claude/skills/create-plugin/…` or `.agents/skills/create-plugin/…`).

- `Skill(name: "create-plugin", file: "reference/ctx.md")` — plugin.json, `server.js` and `ctx`, `tests.js`, the limits.
- `Skill(name: "create-plugin", file: "reference/kit.md")` — the page: its layout, `bn.call`, the classes.
- `Skill(name: "create-plugin", file: "reference/art-direction.md")` — how it must look and read.
- The closest example, whole: `examples/price-watch/…` (tools + job + notification), `examples/fear-greed/…` (an outside API + a tab with a curve), `examples/rebalance/…` (reads an account, proposes orders). Each has `plugin.json`, `server.js`, `tests.js` and, for the tabs, `view/index.html`.

Write with `PluginWrite`, one file per call, the whole file each time. The id is short, lowercase, with dashes (`dividend-tracker`). Always write `tests.js`: one test per tool and per action at least, with mocks for anything outside.

## 3. Check it — until everything passes

Run `PluginCheck`. It parses, runs `setup` against a fake world, runs your tests, and looks at the page. Read the report, fix exactly what it names with `PluginWrite`, run it again. Do not ask the user to test what the check can tell you.

## 4. Activate it

`PluginActivate`. If it asks for nothing beyond what the user already granted (a new version of the same plugin), it runs at once. Otherwise **the user reviews it**: a card appears under your message and a notification is sent. Tell them in one sentence what it will do and what it asks, and that they approve it there. Never say it is active before `PluginRead` says so.

## 5. Show it, then improve it

Once it is active: if it has a tab, open it with `OpenView` (its view id is the plugin's id, `u-…`) and ask whether it is what they wanted. A change ("add a column", "every hour instead") is steps 2 → 4 again on the same id — **always end with `PluginCheck` then `PluginActivate`**: until then you changed the draft only, and the user sees nothing new. Once activated, an open tab reloads by itself. If the page or a call failed, `PluginRead` on the plugin shows the recent errors — fix them before they ask.

## What a plugin can never do — say it plainly instead of working around it

- Place, cancel or close an order by itself, move funds, change leverage. It can only **propose** `PlaceOrder`, `ClosePosition` or `Transfer` through `ctx.confirm`: the user clicks each one.
- See an API key, a password, the user's files, or anything outside its own data.
- Call a host it did not declare, or the whole internet. From the page: no network at all — the page asks its plugin with `bn.call`.
- Use an npm library or `import` another file: `server.js` is one self-contained module.
- Run while BytNode-AI is closed: jobs run while a tab of the app is open.

If the request needs one of these, say so and propose what is possible (a proposal to confirm, a notification, a manual step).

## Changing a plugin another agent wrote

`PluginRead` it first (its state, its files), then the same steps. Keep what the user did not ask to change.
