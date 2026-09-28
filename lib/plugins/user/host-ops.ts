import type { Exchange } from "ccxt";
import type { Confirmation } from "@/lib/domain/plugins";
import type { ExchangeAccount } from "@/lib/domain/types";
import { ALWAYS_ASK } from "@/lib/tools/names";
import { readBytnodeTool } from "@/lib/mcp/bytnode";
import { clientFor } from "@/lib/tools/exchange/client";
import { describeExchangeError } from "@/lib/tools/exchange/errors";
import { toSymbol, type Market } from "@/lib/tools/exchange/symbols";
import { publicFetch } from "@/lib/tools/web/public-fetch";
import type { ConfirmationRequest, NotificationInput } from "../core/contract";
import type { PluginStore } from "../core/store";
import { isQuote, quote } from "../shared/prices";
import { hostAllowed, type Grant, type Permissions } from "./permissions";

/* ---------------------------------------------------------------------------
   The way out of the sandbox: every awaited `ctx.…` call of a plugin
   written by an agent lands here as `(op, args)`.

   ⚠️ EACH OP CHECKS ITS PERMISSION FIRST, against what the user GRANTED —
   not what the plugin asks for now. A refusal is a sentence that says what
   is missing, which the plugin (and the agent reading the log) can act on.
   The keys never cross: BytNode and the exchanges are called here, with
   the keys of the open session, and only the answer goes back.

   An order is never placed here: `confirm` parks a core tool call for the
   user's click (`core/confirmations.ts`), like the DCA does.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

export type Keys = { bytnodeKey: string; accounts: ExchangeAccount[] };

export type LiveDeps = {
  id: string;
  grant: Grant;
  store: PluginStore;
  /** The keys of the open app (the Next server's session, or the MCP
      server's environment); null when no tab is open. */
  keys(): Keys | null;
  notify(n: NotificationInput): Promise<unknown>;
  confirm(r: ConfirmationRequest): Promise<Confirmation>;
  hasView: boolean;
  /** Runs one of the plugin's functions (`ctx.store.update`'s change). */
  invoke(fnId: number, args: unknown[], timeoutMs: number): Promise<unknown>;
};

const FETCH_TIMEOUT = 20_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_STORED = 2 * 1024 * 1024;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const str = (v: unknown, what: string, max = 500): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is required (a text).`);
  if (v.length > max) throw new Error(`${what} is too long (${max} characters at most).`);
  return v.trim();
};

function need(what: keyof Permissions, ok: boolean): void {
  if (ok) return;
  const how: Record<keyof Permissions, string> = {
    network: "permissions.network",
    bytnode: "\"bytnode\": true",
    exchange: "\"exchange\": \"read\" (or \"orders\")",
    schedule: "\"schedule\": true",
    notify: "\"notify\": true",
  };
  throw new Error(`This plugin was not granted ${what}. Declare ${how[what]} in plugin.json and activate it again: the user approves the new permission.`);
}

/** Calls a declared host, redirects included, bounded in time and size. */
export async function guardedFetch(rawUrl: string, init: Record<string, unknown>, allowed: string[]): Promise<{ status: number; ok: boolean; url: string; headers: Record<string, string>; text: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Not a URL: ${rawUrl}`);
  }
  const method = String(init.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new Error(`Method not allowed: ${method}.`);
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === "object") for (const [k, v] of Object.entries(init.headers as Record<string, unknown>)) if (typeof v === "string") headers[k.toLowerCase()] = v;
  let body: string | undefined;
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") body = init.body;
    else {
      body = JSON.stringify(init.body);
      headers["content-type"] ??= "application/json";
    }
  }
  /* Every hop — the first included — must be a host the user granted, and
     a public address; the address checked is the one connected to (no
     second DNS lookup a rebinding could answer differently). */
  const res = await publicFetch(url.toString(), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    maxBytes: FETCH_MAX_BYTES + 1,
    maxRedirects: MAX_REDIRECTS,
    beforeHop: (u) => {
      if (!hostAllowed(u.hostname, allowed)) throw new Error(`${u.hostname} is not in this plugin's permissions (network: ${allowed.join(", ") || "none"}). Declare it in plugin.json → permissions.network.`);
    },
  });
  if (res.truncated) throw new Error(`The answer of ${new URL(res.url).hostname} is larger than ${FETCH_MAX_BYTES / 1024 / 1024} MB.`);
  return { status: res.status, ok: res.status >= 200 && res.status < 300, url: res.url, headers: res.headers, text: res.body.toString("utf8") };
}

/** The granted accounts this process knows (the MCP server of a
    subscription agent knows only that agent's). */
function grantedAccounts(deps: LiveDeps): ExchangeAccount[] {
  const keys = deps.keys();
  return (keys?.accounts ?? []).filter((a) => deps.grant.accounts.includes(a.id));
}

function accountFor(deps: LiveDeps, ref: unknown): ExchangeAccount {
  need("exchange", deps.grant.permissions.exchange !== "none");
  const r = typeof ref === "string" ? ref.trim() : "";
  const list = grantedAccounts(deps);
  const found = list.find((a) => a.id === r) ?? list.find((a) => a.label.toLowerCase() === r.toLowerCase()) ?? (!r && list.length === 1 ? list[0] : undefined);
  if (found) return found;
  if (!deps.keys()) throw new Error("BytNode-AI is not open in a tab: the exchange accounts are not available.");
  const names = list.map((a) => `${a.label} (${a.id})`).join(", ");
  throw new Error(r ? `Account ${r} is not one this plugin may use. Granted: ${names || "none here"}.` : `Say which account: ${names || "none granted"}.`);
}

async function onExchange<T>(account: ExchangeAccount, market: Market, fn: (ex: Exchange) => Promise<T>): Promise<T> {
  try {
    return await fn(await clientFor(account, market));
  } catch (e) {
    throw new Error(describeExchangeError(e));
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const DAY = 86_400_000;
const STABLES = new Set(["USDT", "USDC", "USD", "EUR", "FDUSD", "DAI", "BUSD", "TUSD"]);

type RawTrade = { id?: string; order?: string; symbol?: string; side?: string; price?: number; amount?: number; cost?: number; fee?: { cost?: number; currency?: string }; timestamp?: number; datetime?: string; takerOrMaker?: string };

/** A read of an exchange account beyond the usual five: any of ccxt's
    `fetch…` methods (Earn, deposits, withdrawals, ledger, funding…) that
    the exchange has. ⚠️ Reading only: the name must start with `fetch` and
    a capital (not the raw `fetch`), be a method of the client and be
    declared in its `has`; the answer is data, bounded, without the raw
    `info` blocks. Orders never go this way. */
export async function readMethod(ex: Exchange, method: string, args: unknown[]): Promise<unknown> {
  if (!/^fetch[A-Z][A-Za-z0-9]*$/.test(method)) throw new Error(`${method} is not a reading method: only ccxt's fetch… methods (fetchDeposits, fetchLedger, fetchFundingHistory…).`);
  const fn = (ex as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function" || !ex.has[method]) throw new Error(`${ex.id} has no ${method}.`);
  const out = await (fn as (...a: unknown[]) => Promise<unknown>).apply(ex, args.slice(0, 4));
  const clean = JSON.parse(JSON.stringify(out ?? null, (key, value: unknown) => (key === "info" ? undefined : value))) as unknown;
  if (JSON.stringify(clean).length > MAX_STORED) throw new Error(`${method} answered more than ${MAX_STORED / 1024} kB: narrow it (a symbol, a since, a limit).`);
  return clean;
}

export type TradeOptions = { symbol?: string; since?: string | number; limit?: number; market?: Market };

/** The trades executed on an account (read-only, like the portfolio's
    history): one pair, or — when the exchange wants a pair per request —
    the pairs held today against USDT and USDC; Bybit by 7-day windows,
    as its API answers. Newest first, bounded. */
export async function readTrades(ex: Exchange, opts: TradeOptions): Promise<{ trades: ReturnType<typeof tradeRow>[]; note?: string }> {
  if (!ex.has["fetchMyTrades"]) throw new Error(`${ex.id} does not give the trade history through its API.`);
  const market: Market = opts.market === "futures" ? "futures" : "spot";
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 100)), 500);
  const now = Date.now();
  const sinceRaw = typeof opts.since === "number" ? opts.since : opts.since ? Date.parse(opts.since) : NaN;
  const since = Math.max(Number.isFinite(sinceRaw) ? sinceRaw : now - 30 * DAY, now - 90 * DAY);
  const symbol = opts.symbol ? toSymbol(opts.symbol, market) : undefined;
  const rows: RawTrade[] = [];
  let note: string | undefined;

  if (ex.id === "bybit") {
    for (let start = since; start < now && rows.length < limit * 2; start += 7 * DAY) {
      rows.push(...((await ex.fetchMyTrades(symbol, start, 100, { type: market === "futures" ? "linear" : "spot", endTime: Math.min(start + 7 * DAY, now) })) as RawTrade[]));
    }
  } else if (symbol) {
    rows.push(...((await ex.fetchMyTrades(symbol, since, limit)) as RawTrade[]));
  } else {
    try {
      rows.push(...((await ex.fetchMyTrades(undefined, since, limit)) as RawTrade[]));
    } catch (e) {
      if ((e as { name?: string }).name !== "ArgumentsRequired") throw e;
      /* This exchange wants a pair per request: the pairs held today. */
      const balance = await ex.fetchBalance();
      const held = Object.entries((balance.total ?? {}) as unknown as Record<string, number>)
        .filter(([asset, total]) => (num(total) ?? 0) > 0 && !STABLES.has(asset))
        .map(([asset]) => asset);
      const pairs = held.flatMap((a) => [`${a}/USDT`, `${a}/USDC`]).filter((s) => ex.markets?.[toSymbol(s, market)]).slice(0, 12);
      for (const p of pairs) rows.push(...((await ex.fetchMyTrades(toSymbol(p, market), since, limit)) as RawTrade[]));
      note = `${ex.id} gives the trades pair by pair: these are the pairs held today against USDT and USDC (${pairs.join(", ") || "none"}). Ask for one symbol to read another pair.`;
    }
  }
  const seen = new Set<string>();
  const trades = rows
    .filter((t) => {
      const key = String(t.id ?? `${t.timestamp}|${t.symbol}|${t.amount}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return typeof t.timestamp === "number" && t.timestamp >= since;
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, limit)
    .map(tradeRow);
  return note ? { trades, note } : { trades };
}

const tradeRow = (t: RawTrade) => ({
  id: String(t.id ?? ""),
  orderId: t.order ?? null,
  symbol: t.symbol ?? "",
  side: t.side ?? "",
  price: num(t.price),
  amount: num(t.amount),
  cost: num(t.cost),
  fee: t.fee && num(t.fee.cost) !== null ? { cost: num(t.fee.cost), currency: t.fee.currency ?? null } : null,
  at: t.datetime ?? (typeof t.timestamp === "number" ? new Date(t.timestamp).toISOString() : null),
  takerOrMaker: t.takerOrMaker ?? null,
});

export function liveOps(deps: LiveDeps): (op: string, args: unknown[]) => Promise<unknown> {
  const p = deps.grant.permissions;
  const market = (v: unknown): Market => (v === "futures" ? "futures" : "spot");
  const size = (value: unknown) => {
    const n = JSON.stringify(value ?? null).length;
    if (n > MAX_STORED) throw new Error(`Too much to store at once (${Math.round(n / 1024)} kB, ${MAX_STORED / 1024} kB at most).`);
    return value;
  };

  return async (op, a) => {
    switch (op) {
      case "fetch":
        need("network", p.network.length > 0);
        return guardedFetch(String(a[0]), (a[1] ?? {}) as Record<string, unknown>, p.network);

      case "bytnode": {
        need("bytnode", p.bytnode);
        const key = deps.keys()?.bytnodeKey;
        if (!key) throw new Error("No BytNode key is available right now (BytNode-AI closed, or no key in the settings).");
        const tool = str(a[0], "The BytNode tool", 80);
        const res = await readBytnodeTool(key, tool, (a[1] ?? {}) as Record<string, unknown>, AbortSignal.timeout(60_000));
        if (!res.ok) throw new Error(res.message);
        try {
          return JSON.parse(res.text) as unknown;
        } catch {
          return res.text;
        }
      }

      case "price": {
        need("bytnode", p.bytnode || p.exchange !== "none");
        const symbol = str(a[0], "The symbol", 40);
        const q = await quote(symbol, { bytnodeKey: p.bytnode ? deps.keys()?.bytnodeKey : undefined, accounts: p.exchange !== "none" ? grantedAccounts(deps) : [] });
        if (!isQuote(q)) throw new Error(q.error);
        return q;
      }

      case "exchange.accounts":
        need("exchange", p.exchange !== "none");
        return grantedAccounts(deps).map((x) => ({ id: x.id, label: x.label, exchange: x.exchange, testnet: x.testnet }));

      case "exchange.balance": {
        const account = accountFor(deps, a[0]);
        const b = await onExchange(account, market(a[1]), (ex) => ex.fetchBalance());
        const out: Record<string, { free: number | null; used: number | null; total: number }> = {};
        for (const [asset, total] of Object.entries((b.total ?? {}) as unknown as Record<string, number>)) {
          if (!(num(total) ?? 0)) continue;
          out[asset] = { free: num((b.free as unknown as Record<string, number>)?.[asset]), used: num((b.used as unknown as Record<string, number>)?.[asset]), total };
        }
        return { account: account.label, testnet: account.testnet, market: market(a[1]), balances: out };
      }

      case "exchange.positions": {
        const account = accountFor(deps, a[0]);
        const list = await onExchange(account, "futures", (ex) => ex.fetchPositions());
        return list
          .filter((x) => (num(x.contracts) ?? 0) !== 0)
          .map((x) => ({ symbol: x.symbol, side: x.side, contracts: num(x.contracts), entryPrice: num(x.entryPrice), markPrice: num(x.markPrice), unrealizedPnl: num(x.unrealizedPnl), leverage: num(x.leverage), liquidationPrice: num(x.liquidationPrice) }));
      }

      case "exchange.orders": {
        const account = accountFor(deps, a[0]);
        const m = market(a[2]);
        const symbol = typeof a[1] === "string" && a[1] ? toSymbol(a[1], m) : undefined;
        const list = await onExchange(account, m, (ex) => ex.fetchOpenOrders(symbol));
        return list.map((o) => ({ id: o.id, symbol: o.symbol, side: o.side, type: o.type, price: num(o.price), amount: num(o.amount), filled: num(o.filled), status: o.status, at: o.datetime }));
      }

      case "exchange.trades": {
        const account = accountFor(deps, a[0]);
        const opts = (a[1] && typeof a[1] === "object" ? a[1] : {}) as TradeOptions;
        const r = await onExchange(account, opts.market === "futures" ? "futures" : "spot", (ex) => readTrades(ex, opts));
        return { account: account.label, testnet: account.testnet, ...r };
      }

      case "exchange.read": {
        const account = accountFor(deps, a[0]);
        const method = str(a[1], "The method", 60);
        const opts = (a[3] && typeof a[3] === "object" ? a[3] : {}) as { market?: string };
        return onExchange(account, opts.market === "futures" ? "futures" : "spot", (ex) => readMethod(ex, method, Array.isArray(a[2]) ? a[2] : []));
      }

      case "exchange.ticker": {
        const account = accountFor(deps, a[0]);
        const m = market(a[2]);
        const symbol = toSymbol(str(a[1], "The symbol", 40), m);
        const t = await onExchange(account, m, (ex) => ex.fetchTicker(symbol));
        return { symbol: t.symbol, last: num(t.last), bid: num(t.bid), ask: num(t.ask), change24h: num(t.percentage), at: t.datetime };
      }

      case "store.get":
        return deps.store.read(str(a[0], "The file name", 80), a[1] ?? null);
      case "store.set":
        await deps.store.write(str(a[0], "The file name", 80), size(a[1]));
        return null;
      case "store.update": {
        const fnId = Number(a[2]);
        return deps.store.update(str(a[0], "The file name", 80), a[1] ?? null, async (current) => size(await deps.invoke(fnId, [current], 10_000)));
      }
      case "store.append": {
        const max = typeof a[2] === "number" ? Math.min(Math.max(1, Math.floor(a[2])), 5000) : 1000;
        await deps.store.append(str(a[0], "The file name", 80), size(a[1]), max);
        return null;
      }
      case "store.lines":
        return deps.store.lines(str(a[0], "The file name", 80));

      case "notify": {
        need("notify", p.notify);
        const n = (a[0] ?? {}) as Record<string, unknown>;
        const level = ["info", "success", "warning", "error"].includes(String(n.level)) ? (n.level as NotificationInput["level"]) : "info";
        await deps.notify({ title: str(n.title, "The notification's title", 120), body: str(n.body, "The notification's body", 600), level, ...(deps.hasView ? { action: { kind: "open-view", view: deps.id } } : {}) });
        return null;
      }

      case "confirm": {
        need("exchange", p.exchange === "orders");
        const r = (a[0] ?? {}) as Record<string, unknown>;
        const tool = str(r.tool, "The tool", 40);
        if (!ALWAYS_ASK.has(tool)) throw new Error(`Only ${[...ALWAYS_ASK].join(", ")} can be proposed to the user.`);
        const account = accountFor(deps, r.account ?? r.accountId);
        if (typeof r.args !== "object" || r.args === null) throw new Error("`args` is required: the tool's arguments, as for the agent's own call.");
        const c = await deps.confirm({
          tool,
          args: r.args as Record<string, unknown>,
          accountId: account.id,
          title: str(r.title, "The title", 120),
          reason: str(r.reason, "The reason", 600),
          ...(r.payload && typeof r.payload === "object" ? { payload: r.payload as Record<string, unknown> } : {}),
        });
        return { id: c.id, status: c.status };
      }

      case "sleep": {
        const ms = Math.min(Math.max(0, Number(a[0]) || 0), 10_000);
        await new Promise((r) => setTimeout(r, ms));
        return null;
      }

      default:
        throw new Error(`Unknown ctx call: ${op}.`);
    }
  };
}
