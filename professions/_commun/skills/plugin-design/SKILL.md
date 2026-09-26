---
name: plugin-design
description: Open this before writing or changing the TAB of a BytNode-AI plugin (its view/index.html) — how the page must look so it reads as part of the app — the BytNode kit, the layout, the backdrop veil, the centring, the art direction and the words. The engineering (ctx, tests, activation) is in create-plugin.
---

# Designing a plugin's tab

The user must not be able to tell a tab you wrote from a shipped one (the Watchlist, the Portfolio). The app injects the **BytNode kit** into the page before your code: its colours, fonts, themes and classes. Your job is to build from it, and to keep the page quiet, aligned and centred.

This skill is the design half. The code, the permissions, the tests and the activation are in `create-plugin` — you use both for a plugin with a tab.

## Before writing the page

Read, every time:
- `Skill(name: "plugin-design", file: "reference/patterns.md")` — **the four page patterns of the shipped tabs** (Alerts / Scheduled tasks, DCA, Watchlist / Portfolio, the order form), each with its skeleton. Start from one.
- `Skill(name: "plugin-design", file: "reference/kit.md")` — how the page lives (no network, `bn.call`), the classes, the chart, the formats.
- `Skill(name: "plugin-design", file: "reference/art-direction.md")` — the look and the words.
- A complete page to imitate: `Skill(name: "create-plugin", file: "examples/fear-greed/view/index.html")`.

A subscription agent reads the same files in the skills' folders of its workspace (`.claude/skills/plugin-design/…`, `.claude/skills/create-plugin/…`).

## Pick the pattern first

| The tab is | Pattern (`reference/patterns.md`) |
|---|---|
| A list of things to manage (alerts, tasks, trades, notes) | **1 — like Alerts / Scheduled tasks**: one sheet over the tab, content centred at 980 px, "+ New …" row, rows grouped in one block. |
| One subject with its figure and curve | **2 — like DCA**: hero figure + pill, curve in a block, a row of tiles. |
| Things to pick, then the chosen one | **3 — like Watchlist / Portfolio**: the column `bn-side` + the sheet. |
| Something to fill in | **4 — like Paper trading's ticket**: short fields in a grid, segments, facts, one primary button. |

A page mixes them in that order: pattern 1 or 3 for the frame, 2 and 4 inside.

## Two rules the kit already applies — never undo them

**1. The backdrop is softened, not hidden.** The app's night-blue beams show behind every tab. The panes are that softening: the column is a light veil, the sheet a denser one — exactly the shipped tabs' — and a page without panes (`bn-page`) gets the kit's own veil (`--page-veil`). The tab melts into the app instead of sitting on its brightest light.
- Never paint an opaque background on `html`, `body` or a full-page wrapper: it would cut the tab out of the app like a foreign website.
- Never set `--page-veil` to an opaque colour. You may make it lighter or denser within reason (`rgba(var(--voile), 0.4 … 0.8)`) if the content needs it.
- Sheets, tiles and fields keep their own veils (`--sheet`, `--tile`, `--fill`): do not replace them with solid colours.

**2. The content is centred.** A tab is often very wide; content stretched edge to edge reads badly.
- The sheet alone covers the tab and its head and content are centred at `--bn-width` (980 px), like Scheduled tasks; `bn-app` never goes past `--bn-app-width` (1400 px) and is centred; `bn-page` is a centred column.
- Inside the sheet, everything aligns on the sheet's margin (`bn-head`, `bn-section`, `bn-figure` share `--side`). Do not add your own paddings that break that line.
- Never `width: 100vw`, never a fixed pixel width larger than the sheet, never `position: absolute` to push content to an edge. A narrow content (a form) may use `max-width` inside the sheet, left-aligned on its margin.
- To change the widths, set the variables (`style="--bn-width: 900px"` on `bn-app`), never override the layout.

## Then

1. Build the page from the pattern's skeleton and the kit's classes; your own CSS only for what the kit does not have, with the kit's variables — never `!important`, never a rule on `html`, `body`, `.bn-app`, `.bn-sheet`, `.bn-side` (PluginCheck refuses both).
2. Every group of things in a block: `bn-block`, `bn-items`, `bn-tiles`, `bn-facts`. Nothing floats bare on the sheet but the head, the hero figure, the section titles and the footnote.
3. Figures in the display font (never `bn-mono`), the move as a `bn-pill`, one blue `is-primary` action per place.
4. Words: sentence case, short, active; an empty state that invites to act; errors that say what to do (`reference/art-direction.md`).
5. Look at it as the user will, before activating: the empty state, a long name, a big and a negative number, both themes, a narrow window.
6. `PluginCheck` reports what it sees of the page; the page's own errors come back in `PluginRead`.
