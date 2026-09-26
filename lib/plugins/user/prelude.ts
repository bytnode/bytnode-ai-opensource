/* ---------------------------------------------------------------------------
   The `ctx` a plugin written by an agent sees, INSIDE the sandbox.

   Plain JavaScript evaluated in the QuickJS context before the plugin's
   `server.js`. Everything goes through two functions the host installs:
   `__host(op, json)` (async: a promise the host settles) and
   `__hostSync(op, json)` (the registrations made during `setup`). The
   plugin's functions — a tool's `run`, an action, a job — are kept here
   under a number; the host calls them back with `__invoke(id, json)`.
   Values cross as JSON, never as objects: nothing of the host leaks in.

   The shape of `ctx` is what the `create-plugin` skill documents
   (`professions/_commun/skills/create-plugin/reference/ctx.md`): change
   one, change the other.
--------------------------------------------------------------------------- */

export const PRELUDE = String.raw`
"use strict";
const __fns = new Map();
let __next = 0;
const __keep = (fn, what) => {
  if (typeof fn !== "function") throw new TypeError(what + " must be a function.");
  const id = ++__next;
  __fns.set(id, fn);
  return id;
};
const __once = (fn, what) => {
  if (typeof fn !== "function") throw new TypeError(what + " must be a function.");
  const id = __keep(async (...a) => { try { return await fn(...a); } finally { __fns.delete(id); } }, what);
  return id;
};
const __json = (v) => { try { return JSON.stringify(v === undefined ? null : v); } catch (e) { throw new TypeError("A value could not be turned into JSON: " + e.message); } };
const __call = async (op, args) => { const out = await __host(op, __json(args)); return out === undefined || out === "" ? undefined : JSON.parse(out); };
const __reg = (op, args) => { const out = __hostSync(op, __json(args)); return out === undefined || out === "" ? undefined : JSON.parse(out); };
globalThis.__invoke = async (id, json) => {
  const fn = __fns.get(id);
  if (!fn) throw new Error("This handler no longer exists.");
  const out = await fn(...JSON.parse(json));
  return __json(out);
};
const __text = (a) => a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");
globalThis.console = Object.freeze({
  log: (...a) => __hostSync("log", __json(["info", __text(a)])),
  info: (...a) => __hostSync("log", __json(["info", __text(a)])),
  warn: (...a) => __hostSync("log", __json(["warn", __text(a)])),
  error: (...a) => __hostSync("log", __json(["error", __text(a)])),
});
const __config = Object.freeze(JSON.parse(__CONFIG));
globalThis.ctx = Object.freeze({
  id: __ID,
  config: () => ({ ...__config }),
  tool: (def) => {
    if (!def || typeof def !== "object") throw new TypeError("ctx.tool expects { name, description, parameters, readOnly, run }.");
    __reg("tool", { name: def.name, description: def.description, parameters: def.parameters, readOnly: def.readOnly === true, fn: __keep(def.run, "ctx.tool: run") });
  },
  action: (name, fn) => { __reg("action", { name, fn: __keep(fn, "ctx.action: the handler") }); },
  prompt: (fn) => { __reg("prompt", { fn: __keep(fn, "ctx.prompt: the function") }); },
  job: (spec) => {
    if (!spec || typeof spec !== "object") throw new TypeError("ctx.job expects { id, title, every, run }.");
    __reg("job", { id: spec.id, title: spec.title, every: spec.every, catchUp: spec.catchUp, fn: __keep(spec.run, "ctx.job: run") });
  },
  onConfirmed: (fn) => { __reg("confirmed", { fn: __keep(fn, "ctx.onConfirmed: the function") }); },
  log: (...a) => console.log(...a),
  fetch: async (url, init) => {
    const r = await __call("fetch", [String(url), init || {}]);
    return Object.freeze({ ...r, json: () => JSON.parse(r.text) });
  },
  bytnode: (tool, args) => __call("bytnode", [tool, args || {}]),
  price: (symbol) => __call("price", [symbol]),
  exchange: Object.freeze({
    accounts: () => __call("exchange.accounts", []),
    balance: (account, market) => __call("exchange.balance", [account, market || "spot"]),
    positions: (account) => __call("exchange.positions", [account]),
    orders: (account, symbol, market) => __call("exchange.orders", [account, symbol || null, market || "spot"]),
    ticker: (account, symbol, market) => __call("exchange.ticker", [account, symbol, market || "spot"]),
    trades: (account, options) => __call("exchange.trades", [account, options || {}]),
    read: (account, method, args, options) => __call("exchange.read", [account, method, args || [], options || {}]),
  }),
  store: Object.freeze({
    get: (name, fallback) => __call("store.get", [name, fallback === undefined ? null : fallback]),
    set: (name, value) => __call("store.set", [name, value]),
    update: (name, fallback, change) => __call("store.update", [name, fallback === undefined ? null : fallback, __once(change, "ctx.store.update: change")]),
    append: (name, entry, max) => __call("store.append", [name, entry, max === undefined ? null : max]),
    lines: (name) => __call("store.lines", [name]),
  }),
  notify: (n) => __call("notify", [n]),
  confirm: (request) => __call("confirm", [request]),
  sleep: (ms) => __call("sleep", [ms]),
});
globalThis.__setup = async () => {
  const m = globalThis.__module || {};
  const setup = typeof m.setup === "function" ? m.setup : m.default && typeof m.default.setup === "function" ? m.default.setup : typeof m.default === "function" ? m.default : null;
  if (!setup) throw new Error("server.js must export setup(ctx): \`export default { setup(ctx) { … } }\` or \`export function setup(ctx) { … }\`.");
  await setup(ctx);
};
`;

/* What `tests.js` sees on top of `ctx`, in a check (`PluginCheck`): the
   plugin's own registrations to call, mocks for the outside world, and a
   few assertions. Nothing reaches the network, an exchange or the user. */
export const TEST_PRELUDE = String.raw`
const __tests = [];
globalThis.test = (name, fn) => { if (typeof fn !== "function") throw new TypeError("test(name, fn): fn must be a function."); __tests.push({ name: String(name), fn }); };
const __show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
globalThis.assert = (cond, message) => { if (!cond) throw new Error(message || "Assertion failed."); };
globalThis.assertEqual = (actual, expected, message) => {
  if (__show(actual) !== __show(expected)) throw new Error((message ? message + ": " : "") + "expected " + __show(expected) + ", got " + __show(actual) + ".");
};
globalThis.assertIncludes = (text, part, message) => {
  if (typeof text !== "string" || !text.includes(part)) throw new Error((message ? message + ": " : "") + "expected the text to include " + __show(part) + ", got " + __show(text) + ".");
};
globalThis.assertThrows = async (fn, part) => {
  try { await fn(); } catch (e) { if (part && !String(e && e.message).includes(part)) throw new Error("It threw, but not with " + __show(part) + ": " + String(e && e.message)); return; }
  throw new Error("Expected an error, nothing was thrown.");
};
globalThis.mock = Object.freeze({
  fetch: (url, response) => { __reg("mock", { kind: "fetch", key: String(url), value: response }); },
  bytnode: (tool, response) => { __reg("mock", { kind: "bytnode", key: String(tool), value: response }); },
  price: (symbol, price) => { __reg("mock", { kind: "price", key: String(symbol), value: price }); },
  exchange: (method, response) => { __reg("mock", { kind: "exchange", key: String(method), value: response }); },
  accounts: (list) => { __reg("mock", { kind: "accounts", key: "", value: list }); },
});
globalThis.plugin = Object.freeze({
  tool: (name, args) => __call("test.tool", [name, args || {}]),
  action: (name, params) => __call("test.action", [name, params || {}]),
  job: (id) => __call("test.job", [id]),
  prompt: () => __call("test.prompt", []),
  notifications: () => __call("test.notifications", []),
  confirmations: () => __call("test.confirmations", []),
  confirm: (id, outcome) => __call("test.confirmed", [id, outcome || "allowed"]),
});
globalThis.__runTests = async () => {
  const out = [];
  for (const t of __tests) {
    try { await t.fn(); out.push({ name: t.name, ok: true }); }
    catch (e) { out.push({ name: t.name, ok: false, error: String((e && e.message) || e) }); }
  }
  return out;
};
`;
