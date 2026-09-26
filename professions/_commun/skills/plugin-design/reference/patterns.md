# The four page patterns of BytNode-AI

Every shipped tab is one of these four. Pick the one your plugin is, and copy its skeleton — then fill it. Each skeleton uses only the kit's classes; do not restyle them.

## 1. A list to manage — like **Alerts** and **Scheduled tasks**

One sheet over the whole tab, content centred. A head (title, one-line summary; on the right a status, the refresh icon and ONE blue action), then blocks: an overview block if there is one (a timeline, a figure), the "+ New …" row, the rows grouped in one block, a footnote.

```html
<div class="bn-app">
  <main class="bn-sheet">
    <header class="bn-head">
      <div class="bn-head-text">
        <h1 class="bn-title">Dividends</h1>
        <p class="bn-sub">4 followed · the next one Nov 14</p>
      </div>
      <div class="bn-actions">
        <span class="bn-status"><span class="bn-dot is-on"></span>Updated 17:12</span>
        <button class="bn-icon" id="refresh" aria-label="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/></svg></button>
        <button class="bn-button is-primary" id="new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New dividend</button>
      </div>
    </header>
    <div class="bn-body">
      <section class="bn-section">
        <div class="bn-stack">
          <div class="bn-block">
            <p class="bn-block-title">Next 30 days</p>
            <div class="bn-chart" id="curve" style="--bn-chart-height: 180px"></div>
          </div>
          <button class="bn-add" id="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New dividend</button>
        </div>
      </section>
      <section class="bn-section">
        <h2 class="bn-section-title">Followed</h2>
        <ul class="bn-items" id="list">
          <li class="bn-item">
            <span class="bn-dot is-on"></span>
            <span class="bn-item-main">
              <span class="bn-item-title">AAPL <span class="bn-muted">Apple</span></span>
              <span class="bn-item-sub">0.25 USD · quarterly · next Nov 14</span>
            </span>
            <span class="bn-item-aside"><span class="bn-chip">Quarterly</span>in 49 days<label class="bn-switch"><input type="checkbox" checked aria-label="Follow AAPL"></label></span>
          </li>
        </ul>
      </section>
      <p class="bn-footnote">Dates are the payers' announcements. Amounts before tax.</p>
    </div>
  </main>
</div>
```

## 2. A figure and its detail — like **DCA** (one plan) and **Paper trading**'s middle sheet

A head, then the hero figure with its move as a pill and one sentence, a section with the curve in a block, a row of tiles, then the detail rows.

```html
<div class="bn-body">
  <div class="bn-figure">
    <span class="bn-figure-value">98.85</span><span class="bn-figure-unit">USDT</span>
    <span class="bn-pill is-down">−1.15 %</span>
    <span class="bn-muted">−1.15 USDT on 100.00 USDT invested</span>
  </div>
  <section class="bn-section">
    <h2 class="bn-section-title">Value <small>what was bought, at each day's close</small></h2>
    <div class="bn-block"><div class="bn-chart" id="curve"></div></div>
  </section>
  <section class="bn-section">
    <div class="bn-tiles" style="--cols: 3">
      <div class="bn-tile"><span class="bn-tile-label">Invested</span><span class="bn-tile-value">100.00 USDT</span><span class="bn-tile-sub">1 purchase</span></div>
      <div class="bn-tile"><span class="bn-tile-label">Value</span><span class="bn-tile-value">98.85 USDT</span><span class="bn-tile-sub">at the current price</span></div>
      <div class="bn-tile"><span class="bn-tile-label">Result</span><span class="bn-tile-value is-down">−1.15 USDT</span><span class="bn-tile-sub">−1.15 %</span></div>
    </div>
  </section>
</div>
```

## 3. Things to pick, then the chosen one — like **Watchlist**, **Portfolio**, **DCA**

The column (`bn-side`) lists; the sheet shows the chosen one with pattern 2 inside. The column: its title and count, an add field or "+ New …" line, the rows (`bn-list` / `bn-row`, `is-selected` on the chosen one).

```html
<div class="bn-app">
  <aside class="bn-side">
    <div class="bn-side-head"><h2 class="bn-side-title">Journal</h2><span class="bn-count">12</span></div>
    <ul class="bn-list">
      <li><button class="bn-row is-selected"><span class="bn-row-name"><b>BTC/USDT</b><small>Spot · 16 Sept</small></span><span class="bn-row-value">29.88</span><span class="bn-pill is-up">+2.1 %</span></button></li>
    </ul>
  </aside>
  <main class="bn-sheet">…pattern 2…</main>
</div>
```

## 4. A form — like **Paper trading**'s order ticket, or the new-alert window

Labels above short fields, side by side in a grid; the choices as segments; the computed values in a facts panel; ONE full-width primary button at the end. Never a column of full-width inputs.

```html
<section class="bn-section">
  <h2 class="bn-section-title">Add a trade <small>no exit price = still open</small></h2>
  <div class="bn-block">
    <form class="bn-stack" id="form">
      <div class="bn-segments" role="radiogroup"><button type="button" class="is-on">Buy</button><button type="button">Sell</button></div>
      <div class="bn-form-grid">
        <label class="bn-field">Date<input class="bn-input" type="date" name="date"></label>
        <label class="bn-field">Pair<input class="bn-input" name="pair" placeholder="BTC/USDT"></label>
        <label class="bn-field">Entry price<input class="bn-input" name="entry" inputmode="decimal"></label>
        <label class="bn-field">Amount (USDT)<input class="bn-input" name="amount" inputmode="decimal"></label>
        <label class="bn-field is-wide">Why you took it<textarea class="bn-textarea" name="note" placeholder="Setup, signal, context"></textarea></label>
      </div>
      <dl class="bn-facts"><div><dt>Fees</dt><dd>0.04 USDT</dd></div><div><dt>Result</dt><dd>—</dd></div></dl>
      <button class="bn-button is-primary">Add the trade</button>
    </form>
  </div>
</section>
```

## What the shipped tabs never do

- An opaque background anywhere, `!important`, or a rule on `html`, `body`, `.bn-app`, `.bn-sheet`, `.bn-side` (PluginCheck refuses `!important`).
- Figures in monospace: values use the display font as the kit sets it (`bn-mono` is for ids and codes only).
- Several blue buttons in one place; a red button that is not a deletion.
- A table for what is a list of things to manage (use `bn-items`); a table is for columns of numbers.
- Bare content floating on the sheet: every group of things sits in a block (`bn-block`, `bn-items`, `bn-tiles`, `bn-facts`).
