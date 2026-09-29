# The page of a plugin

`view/index.html` is shown in the plugin's own tab. The app injects the **BytNode kit** before your code: the app's colours, fonts, light and dark themes, the backdrop veil, the centring, and the classes below. Build the page from them and it looks like the app's own tabs (the watchlist, the portfolio).

## How the page lives

- It runs in a closed frame: **no network at all** (no `fetch`, no CDN, no image from a URL, no web font), no access to the app. Everything it shows comes from its plugin: `bn.call("action", params)` → the handler you registered with `ctx.action`.
- Everything is inline or in `view/` files: `<link rel="stylesheet" href="style.css">` and `<script src="app.js"></script>` are put inline for you. No `import`.
- Plain HTML, CSS and JavaScript — no framework. Write small render functions that rebuild a part of the page from data, and use `bn.esc(text)` for anything you put in `innerHTML`.
- The page is read at 90 % like the app's; the kit handles it (and `bn.chart` too).
- Errors of the page are reported to the plugin's log automatically; the user sees a quiet band and can reload.

## bn — the page's only way out

| Call | Does |
|---|---|
| `await bn.call(action, params)` | Runs `ctx.action(action, …)` of this plugin; returns its JSON, or rejects with its error message. |
| `bn.chart(elementOrSelector, series, options)` | A line chart in the app's style (green if it rises over the period, red if it falls). `series`: `[{ t: "2026-09-01", v: 102.4 }, …]` (ISO date or timestamp) or plain numbers. `options`: `{ format: (v) => text, axis: false, color, empty: "No data yet." }`. Returns `{ update(series) }`. Redraws on resize and theme. |
| `bn.fmt.money(n, "USD")`, `bn.fmt.num(n, digits)`, `bn.fmt.pct(n)` (+/−, "%"), `bn.fmt.compact(n)` (1.2K), `bn.fmt.date(iso)`, `bn.fmt.time(iso)` | Number and date formats — "—" for a missing value. |
| `bn.tone(n)` | `"is-up"`, `"is-down"` or `"is-flat"` — the class for a move. |
| `bn.esc(text)` | Text safe for `innerHTML`. |
| `bn.openView("watchlist", { symbol: "BTC/USDT" })` | Opens another tab of the app. |
| `bn.theme()`, `bn.onTheme((theme) => …)` | `"dark"` or `"light"`, followed live. |

## Layout

The page has a translucent veil over the app's backdrop (`--page-veil`, on `html`) and its content is centred: the sheet alone at `--bn-width` (1080 px), `bn-app` at most `--bn-app-width` (1400 px), `bn-page` as one centred column. Keep both (see the plugin-design skill).

A left column and a sheet — or the sheet alone:

```html
<div class="bn-app">
  <aside class="bn-side">                      <!-- optional: a list to pick from -->
    <div class="bn-side-head"><h2 class="bn-side-title">Dividends</h2><span class="bn-count">4</span></div>
    <ul class="bn-list">
      <li><button class="bn-row is-selected"><span class="bn-row-name"><b>AAPL</b><small>Apple · next Nov 14</small></span><span class="bn-row-value">0.25</span><span class="bn-pill is-up">+2.1 %</span></button></li>
    </ul>
  </aside>
  <main class="bn-sheet">
    <header class="bn-head">
      <div class="bn-head-text"><h1 class="bn-title">Apple</h1><p class="bn-sub">Quarterly dividend, paid in USD</p></div>
      <div class="bn-actions"><button class="bn-icon" title="Refresh" aria-label="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/></svg></button></div>
    </header>
    <div class="bn-body">
      <div class="bn-figure"><span class="bn-figure-value">$1.00</span><span class="bn-figure-unit">a year</span></div>
      <section class="bn-section">
        <h2 class="bn-section-title">Last year <small>4 payments</small></h2>
        <div class="bn-chart" id="curve"></div>
      </section>
      <section class="bn-section">
        <h2 class="bn-section-title">Figures</h2>
        <div class="bn-tiles" style="--cols: 3">
          <div class="bn-tile"><span class="bn-tile-label">Yield</span><span class="bn-tile-value">0.44 %</span><span class="bn-tile-sub">at today's price</span></div>
          <div class="bn-tile"><span class="bn-tile-label">Next</span><span class="bn-tile-value">Nov 14</span><span class="bn-tile-sub">in 50 days</span></div>
          <div class="bn-tile"><span class="bn-tile-label">Change</span><span class="bn-tile-value is-up">+4.2 %</span><span class="bn-tile-sub">vs last year</span></div>
        </div>
      </section>
    </div>
  </main>
</div>
```

## The classes

| Class | For |
|---|---|
| `bn-app` | The whole tab (flex row, full height), centred at `--bn-app-width`. With the sheet alone inside, the sheet is centred at `--bn-width` with a margin all round. |
| `bn-page` | A centred column (`--bn-width`) for a page without the column / sheet structure. |
| `bn-side`, `bn-side-head`, `bn-side-title`, `bn-count` | The left column: a light veil, 340 px (`style="--bn-side: 300px"` to change). |
| `bn-sheet` | The main sheet: denser veil, round corners. Alone in `bn-app`, it fills the tab. |
| `bn-head`, `bn-head-text`, `bn-title`, `bn-sub`, `bn-actions` | The sheet's header. `bn-title` wears BytNode's metal ink — the sheet's title only. |
| `bn-body` | The scrolling part of the sheet. |
| `bn-section`, `bn-section-title` (+ `<small>`) | A block of the sheet, aligned on the sheet's margin. |
| `bn-figure`, `bn-figure-value`, `bn-figure-unit` | One big figure at the top (display font — never `bn-mono`), followed by a `bn-pill` and a `bn-muted` sentence. |
| `bn-stack` | Blocks one under the other, 16 px apart. |
| `bn-block`, `bn-block-title` | A rounded panel on the sheet: a chart, a timeline, a form. Every group of things sits in a block. |
| `bn-items`, `bn-item`, `bn-item-main`, `bn-item-title`, `bn-item-sub`, `bn-item-aside` | Rows grouped in ONE block, 2 px apart — the Tasks and Alerts lists. `button.bn-item` / `a.bn-item` are clickable. |
| `bn-add` | The block-wide blue "+ New …" row (with a plus `<svg>`). |
| `bn-chip` | A quiet label in a pill: "Once", "Every time". |
| `bn-dot` (+ `is-on`/`is-up`, `is-down`, `is-warn`) | A state: green, red, orange; grey when off. |
| `bn-status` | "● Updated 17:12" beside the head's actions (a `bn-dot` inside). |
| `bn-switch` | `<label class="bn-switch"><input type="checkbox"></label>` — on / off. |
| `bn-facts` | `<dl class="bn-facts"><div><dt>Fee</dt><dd>0.1 %</dd></div>…</dl>` — labelled values in a panel. |
| `bn-form-grid` (+ `is-wide` on a field) | Fields side by side, wrapping. |
| `bn-link` (+ `is-danger`) | A blue text action ("Edit", "Max 9,853.12"). |
| `bn-footnote` | The page's closing words, small and faint. |
| `bn-tiles` (`--cols: 2..4`), `bn-tile`, `bn-tile-label`, `bn-tile-value`, `bn-tile-sub` | Figures on square tiles, one round block. `button.bn-tile` is clickable; `is-selected`. |
| `bn-list`, `bn-row`, `bn-row-name` (`<b>` + `<small>`), `bn-row-value` | A list of rows; `button.bn-row` is clickable; `is-selected`. |
| `bn-pill` + `is-up` / `is-down` / `is-flat` | A move, as a coloured pill. |
| `bn-table` (+ `is-num` on numeric cells, `is-up`/`is-down` on a cell) | A table of rows on tiles. |
| `bn-chart` (`--bn-chart-height`) | The box `bn.chart` draws in. |
| `bn-button` (+ `is-primary` = THE blue action, one per place; `is-danger`), `bn-icon` (round, holds an `<svg>`) | Buttons; a `<svg>` inside a `bn-button` is sized for you ("+ New alert"). |
| `bn-form`, `bn-form-row`, `bn-field` (a `<label>`), `bn-input`, `bn-select`, `bn-textarea` | Forms. |
| `bn-segments` (buttons inside, `is-on`) | A choice of two to four: 7D / 30D / 1Y. |
| `bn-badge` (+ `is-live`, `is-testnet`, `is-paper`) | LIVE / TESTNET / PAPER — on every account and every figure about one. |
| `bn-note`, `bn-error`, `bn-empty` (`<b>` + text + a button), `bn-loading` | A remark, an error, an empty state, a loading line. |
| `bn-up`, `bn-down`, `bn-muted`, `bn-mono`, `bn-ink` | Text colours; monospace for ids and codes only (never figures); the metal ink. |

Layout variables: `--page-veil` (the backdrop veil, translucent — never opaque), `--bn-width` (the centred sheet or page, 1080 px), `--bn-app-width` (the column + sheet, 1400 px). `html.bn-clear` removes the veil (rarely right).

CSS variables if you need your own rules: `--label`, `--label-2`, `--label-3` (text, strong to faint), `--fill`, `--tile`, `--tile-strong`, `--sep`, `--up`, `--down`, `--blue`, `--orange`, `--purple`, `--r`, `--r-sm`, `--r-block`, `--side`, `--font-display`, `--font-text`, `--font-mono`. They follow the theme.

## A page's script, the usual shape

```html
<script>
  const main = document.getElementById("main");
  async function load() {
    main.innerHTML = '<p class="bn-loading">Loading…</p>';
    try {
      const data = await bn.call("list");
      render(data);
    } catch (e) {
      main.innerHTML = '<p class="bn-error">' + bn.esc(e.message) + "</p>";
    }
  }
  function render(list) {
    if (!list.length) {
      main.innerHTML = '<div class="bn-empty"><b>No dividend yet</b>Add the first one to see its payments.<button class="bn-button is-primary" id="add">Add a dividend</button></div>';
      return;
    }
    main.innerHTML = list.map((d) => '<div class="bn-tile"><span class="bn-tile-label">' + bn.esc(d.symbol) + '</span><span class="bn-tile-value">' + bn.fmt.money(d.amount) + "</span></div>").join("");
  }
  load();
</script>
```

Refresh what may change with a button, or when the user acts — the page has no timers of its own to rely on while it is behind another tab.
