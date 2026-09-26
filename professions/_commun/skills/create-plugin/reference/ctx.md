# The plugin API

A plugin is a folder of plain files, written with `PluginWrite`:

| File | What it is |
|---|---|
| `plugin.json` | Its identity, its settings, its tab, and the permissions it asks for. |
| `server.js` | Its code: one JavaScript module (no TypeScript, no import). |
| `tests.js` | Its tests, run by `PluginCheck` with mocks. Required. |
| `view/index.html` (+ `view/*.css`, `view/*.js`) | Its tab, if it has one. See `reference/kit.md`. |

## plugin.json

```json
{
  "name": "Dividend tracker",
  "version": "1.0.0",
  "category": "portfolio",
  "summary": "The dividends you follow, and when they pay.",
  "forAgents": "Keeps the dividends the user follows, with the next payment of each; DividendList reads them.",
  "description": "A longer presentation for its page in the library (optional).",
  "permissions": {
    "network": ["api.example.com"],
    "bytnode": false,
    "exchange": "none",
    "schedule": true,
    "notify": true
  },
  "config": {
    "currency": { "type": "string", "title": "Currency", "default": "USD", "enum": ["USD", "EUR"] },
    "threshold": { "type": "number", "title": "Alert threshold (%)", "default": 5, "minimum": 0, "maximum": 100 }
  },
  "view": { "title": "Dividends", "description": "The coming payments and what they bring." }
}
```

- `category`: `market`, `portfolio`, `automation` or `tools`.
- `summary` speaks to the user ("your"). `forAgents` speaks ABOUT the user ("the user"), never "you" / "your", in full sentences ending with a full stop: it goes into every agent's prompt.
- `view`: omit it (or `null`) when there is no tab.
- `config`: settings the user changes in the library. Types: `string`, `number`, `integer`, `boolean`; optional `enum` (+ `enumLabels`), `minimum`, `maximum`, `description`, `format` (`time` → "08:30"). `default` is required and must be valid. The plugin reads them with `ctx.config()`.

### permissions — ask for the least

| Permission | Gives | Ask for it when |
|---|---|---|
| `"network": ["api.x.com", "*.y.com"]` | `ctx.fetch` to these hosts only (`*.` = its subdomains). Never "everything". | The data comes from a website or an API. Put the exact host names. |
| `"bytnode": true` | `ctx.bytnode(…)` and `ctx.price(…)`, with the user's BytNode key (the plugin never sees it). | Prices, market data. |
| `"exchange": "read"` | `ctx.exchange.*`: balances, positions, open orders, tickers and the trade history of the accounts the user ticks at the review. | It reads their portfolio. |
| `"exchange": "orders"` | `"read"` + `ctx.confirm(…)`: propose an order the user confirms, one by one. | It proposes orders. Never more. |
| `"schedule": true` | `ctx.job(…)`: run on a schedule while the app is open. | It checks or refreshes on its own. |
| `"notify": true` | `ctx.notify(…)`. | It warns the user. |

The user reads these in plain words before granting them. A new version that asks for more goes back to them.

## server.js

```js
export default {
  setup(ctx) {
    // REGISTER here — tools, actions, jobs, a prompt section. Read or fetch
    // nothing during setup: do it inside the handlers.
  },
};
```

`export function setup(ctx) { … }` works too. `setup` may be `async`. It has 5 seconds.

### What setup registers

**`ctx.tool({ name, description, parameters, readOnly, run })`** — a tool for every agent.

```js
ctx.tool({
  name: "DividendList",                       // PascalCase, unique in the app
  description: "Lists the dividends the user follows, with the next payment date. Use it when the user asks about their dividends.",
  parameters: {                               // JSON Schema, type object
    type: "object",
    properties: { symbol: { type: "string", description: "Only this one (AAPL)." } },
    required: [],
    additionalProperties: false,
  },
  readOnly: true,                             // true: runs without asking; false: asks in "Ask before acting" mode
  run: async ({ symbol }) => {
    const list = await ctx.store.get("dividends", []);
    return { text: "…what the agent reads…", table: { title: "Dividends", columns: ["Symbol", "Next", "Amount"], rows: [["AAPL", "2026-11-14", "0.25"]] } };
  },
});
```

`run` returns what the agent reads:
- a **string**;
- or `{ text, facts }` — `facts: { title, rows: [["Label", "value"], …] }` — a card of figures in the thread;
- or `{ text, table }` — `table: { title, columns: […], rows: [[…], …] }` (30 rows shown);
- or `{ error: "what went wrong, and what to do" }` — the call fails with that message.

Arguments arrive already checked against `parameters`. Say in `description` what the tool does AND when to use it: that is how agents decide.

**`ctx.action(name, handler)`** — something the plugin's page calls with `bn.call(name, params)`. `name`: lowercase, digits, dashes. `handler(params)` returns any JSON (or throws: the page's promise rejects with the message).

```js
ctx.action("list", async () => ctx.store.get("dividends", []));
ctx.action("add", async ({ symbol, amount }) => {
  if (!symbol) throw new Error("Give a symbol.");
  return ctx.store.update("dividends", [], (list) => [...list, { symbol: String(symbol).toUpperCase(), amount: Number(amount) || 0 }]);
});
```

**`ctx.job({ id, title, every, catchUp, run })`** — needs `"schedule": true`. Runs while BytNode-AI is open in a tab.
- `every`: `"every 15 minutes"`, `"every 2 hours"`, `"every hour"`, `"daily at 08:00"`, `"every monday at 09:30"` (local time). At least one minute.
- `catchUp`: `"skip"` (default) or `"run-once-on-start"` — a run missed while the app was closed happens once when it opens.
- `run({ reason })` returns a short line for the log, or throws (the user is told once when it starts failing). 5 minutes at most.

**`ctx.prompt(async ({ engine, subagent }) => text)`** — a short live context added to every agent's prompt at each turn (1,200 characters at most): "The user follows 4 dividends; the next is AAPL on Nov 14." Keep it short and factual; return "" when there is nothing to say.

**`ctx.onConfirmed(async (c) => { … })`** — called when the user decided an order the plugin proposed. `c`: `{ id, tool, args, status, outcome, payload }`, `status` = `"allowed"` (it ran; `outcome` is the tool's answer), `"failed"`, `"denied"` or `"expired"`.

### What the handlers await

| Call | Returns | Needs |
|---|---|---|
| `ctx.store.get(name, fallback)` | The stored JSON, or `fallback`. | — |
| `ctx.store.set(name, value)` | — | — |
| `ctx.store.update(name, fallback, (current) => next)` | `next`, written. Safe when two calls race. | — |
| `ctx.store.append(name, entry, max)` / `ctx.store.lines(name)` | A log of entries, the oldest dropped beyond `max` (1,000 by default). | — |
| `ctx.fetch(url, { method, headers, body })` | `{ status, ok, url, headers, text, json() }`. 20 s, 5 MB. `body` may be an object (sent as JSON). | `network` |
| `ctx.bytnode(tool, args)` | The answer of a BytNode data tool, parsed: the same tools and arguments as your BytNode tools (`get_market_data`, …). | `bytnode` |
| `ctx.price("BTC/USDT")` | `{ symbol, price, change24h, source, at }` — BytNode first, else a granted account's exchange. | `bytnode` or `exchange` |
| `ctx.exchange.accounts()` | `[{ id, label, exchange, testnet }]` — the accounts the user granted. | `exchange` |
| `ctx.exchange.balance(account, market)` | `{ account, testnet, market, balances: { BTC: { free, used, total }, … } }`. `market`: `"spot"` (default) or `"futures"`. | `exchange` |
| `ctx.exchange.positions(account)` | `[{ symbol, side, contracts, entryPrice, markPrice, unrealizedPnl, leverage, liquidationPrice }]` | `exchange` |
| `ctx.exchange.orders(account, symbol, market)` | Open orders: `[{ id, symbol, side, type, price, amount, filled, status, at }]` | `exchange` |
| `ctx.exchange.ticker(account, symbol, market)` | `{ symbol, last, bid, ask, change24h, at }` | `exchange` |
| `ctx.exchange.trades(account, { symbol, since, limit, market })` | The trades executed on the account, newest first: `{ account, testnet, trades: [{ id, orderId, symbol, side, price, amount, cost, fee: { cost, currency }, at, takerOrMaker }], note }`. Default: the last 30 days (90 at most), 100 trades (500 at most). Without `symbol`, some exchanges (Binance…) are read pair by pair on the pairs held today against USDT/USDC — `note` says so; give a `symbol` for another pair. | `exchange` |
| `ctx.notify({ title, body, level })` | — (`level`: info, success, warning, error). Clicking it opens the plugin's tab. | `notify` |
| `ctx.confirm({ tool, account, args, title, reason, payload })` | `{ id, status: "pending" }` — see below. | `exchange: "orders"` |
| `ctx.sleep(ms)` | Waits (10 s at most). | — |

`account`: the account's id or label, as `ctx.exchange.accounts()` gives them; optional when only one is granted. The user may have granted accounts this process cannot see (an agent's own session): handle the error.

**Proposing an order.** `ctx.confirm` parks a call to a core tool — `PlaceOrder`, `ClosePosition` or `Transfer` — and the user gets it as a notification with the same prompt as in a conversation (the order in one line, LIVE / TESTNET, Allow / Deny). It runs only on their click, with the core tool's own checks. `args` are exactly the tool's arguments without `account`:

```js
await ctx.confirm({
  tool: "PlaceOrder",
  account: accountId,
  args: { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 50 },   // or amount (base), price for a limit, market: "futures"…
  title: "Rebalance: buy 50 USDT of BTC",
  reason: "BTC is 8 % under its target weight.",
  payload: { plan: "weekly" },   // anything you need back in onConfirmed
});
```

### Also available

`ctx.id` (the plugin's id), `ctx.config()` (the settings, defaults applied), `ctx.log(…)` and `console.log/warn/error` (kept in the plugin's log, read with `PluginRead`). `Date`, `Math`, `JSON`, `Intl` and `Promise` work. **No** `setTimeout`/`setInterval` (use a job), no `fetch` (use `ctx.fetch`), no `require`/`import`, no `process`.

### Limits

64 MB of memory; 2 seconds of computation without awaiting anything (an endless loop is stopped); 30 seconds per call (5 minutes per job run). Only JSON goes in and out: no functions, no `Date` objects (send ISO strings), no `Map`.

## tests.js

Run by `PluginCheck`, after `setup`, against a fake world: nothing real is called, the store starts empty, the settings are their defaults. The tests run in order and share the store; a mock set again for the same key replaces the previous one, and a mock written at the top of the file holds for every test.

```js
test("adds a dividend and lists it", async () => {
  mock.fetch("https://api.example.com/dividends/", { json: { amount: 0.25, date: "2026-11-14" } });  // URL prefix → answer ({ json } or { text }, optional status)
  await plugin.action("add", { symbol: "AAPL" });
  const r = await plugin.tool("DividendList", {});      // { ok, output, card }
  assert(r.ok, "the tool answers");
  assertIncludes(r.output, "AAPL");
  assertEqual(r.card.kind, "table");
});

test("refuses an empty symbol", async () => {
  await assertThrows(() => plugin.action("add", {}), "Give a symbol");
});
```

- Calls: `plugin.tool(name, args)`, `plugin.action(name, params)`, `plugin.job(id)`, `plugin.prompt()`, `plugin.notifications()`, `plugin.confirmations()`, `plugin.confirm(id, "allowed" | "denied")` (calls your `onConfirmed`).
- Mocks: `mock.fetch(urlPrefix, { json | text, status })`, `mock.bytnode(tool, answer)`, `mock.price(symbol, price)`, `mock.exchange("balance" | "positions" | "orders" | "ticker" | "trades", answer)`, `mock.accounts([{ id, label, exchange, testnet }])` (default: one testnet account `test-account`).
- Assertions: `assert(cond, message)`, `assertEqual(actual, expected)` (deep, by JSON), `assertIncludes(text, part)`, `await assertThrows(fn, partOfMessage)`.
- A permission used but not declared fails the call with "without declaring": the check catches it before the user does.

Test each tool and action, the empty state, and one failure (a bad input, an API error with `{ status: 500 }`).
