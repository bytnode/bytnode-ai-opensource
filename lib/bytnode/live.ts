import { describeRestError } from "./rest";

/* ---------------------------------------------------------------------------
   BytNode's WebSocket, for the app's live prices: ONE connection per key,
   shared by every view, widget and background job, opened when something
   wants a price and closed a minute after nothing does.

   What it carries: the trades of each pair (`trades.spot.<SYM>`, every
   trade of every venue, sent in frames every 100 ms). The last trade is
   the live price; there is no ticker channel, so the changes over a window
   are worked out against a REST reading (`lib/plugins/shared/prices.ts`).

   Two ways to want a pair:
     - `watch(sym, onTick)`: held until the returned function is called (a
       view's live stream, `app/api/market/live/route.ts`);
     - `lease(sym, ms)`: held for a while (a job that prices every minute,
       an action the view calls again and again).
   The subscriptions follow: one `subscribe` / `unsubscribe` at a time (a
   subscribe is all or nothing on the server; one pair per message tells
   which pair a refusal is about). The connection is the engine's
   (`bytnode_api/services/stream`): the key in the `X-API-KEY` header of
   the handshake (never in the URL), a session of at most six hours (close
   4010: back at once), the plan's cap on simultaneous connections (close
   4003 "limit…"), pings answered by the runtime itself.

   A connection refused at the handshake (no live access on the plan, a
   wrong key) is told in plain English (`problem`, from a plain GET on the
   same address, which the edge refuses with the same reason) and tried
   again later; meanwhile the prices fall back on REST readings.

   SERVER ONLY. The socket factory is injected (tests).
--------------------------------------------------------------------------- */

export const BYTNODE_WS_URL = process.env.BYTNODE_WS_URL ?? "wss://ws.bytnode.com/ws";

export type Tick = { price: number; at: number };

export type FeedState = "idle" | "connecting" | "live" | "unavailable";

/** What the feed needs of a WebSocket (the runtime's own, in Node). */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type FeedDeps = {
  connect: (url: string, key: string) => SocketLike;
  /** Why the handshake was refused, in plain English; null when unknown. */
  probe: (url: string, key: string) => Promise<string | null>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
};

const OPEN = 1;
/** Closed this long after nothing wants a price any more. */
export const IDLE_MS = 60_000;
/** How often the expired leases are let go. */
const SWEEP_MS = 30_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/** After a refusal (plan, key, the connection cap): not before. */
const REFUSED_RETRY_MS = 5 * 60_000;
const LIMIT_RETRY_MS = 60_000;
/** A request the server has not answered in this time: the connection is
    taken for dead and opened again. */
const REQUEST_MS = 10_000;

const channelOf = (sym: string) => `trades.spot.${sym}`;
const symOf = (channel: string) => (/^trades\.spot\.([A-Z0-9]+)$/i.exec(channel)?.[1] ?? "").toUpperCase();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const timeOf = (v: unknown): number | undefined => {
  const n = num(v);
  if (n !== undefined) return n < 1e12 ? n * 1000 : n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};

/** The last trade of a frame's trades (`[{time, price, …}]`), or null. */
export function lastTrade(data: unknown, fallbackAt: number): Tick | null {
  const rows = Array.isArray(data) ? data : isRecord(data) ? [data] : [];
  let best: Tick | null = null;
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const price = num(r.price);
    if (price === undefined || price <= 0) continue;
    const at = timeOf(r.time) ?? fallbackAt;
    if (!best || at >= best.at) best = { price, at };
  }
  return best;
}

export class LiveFeed {
  private socket: SocketLike | null = null;
  private stateNow: FeedState = "idle";
  private problemNow: string | null = null;
  private readonly ticks = new Map<string, Tick>();
  private readonly watchers = new Map<string, Set<(t: Tick) => void>>();
  private readonly counts = new Map<string, number>();
  private readonly leases = new Map<string, number>();
  /** Subscribed on the server, as its last answer says. */
  private readonly active = new Set<string>();
  /** Pairs the server will not stream (an unknown channel). */
  private readonly refused = new Set<string>();
  private pending: { op: "subscribe" | "unsubscribe"; sym: string } | null = null;
  private attempt = 0;
  private notBefore = 0;
  private reconnectTimer: unknown = null;
  private idleTimer: unknown = null;
  private sweepTimer: unknown = null;
  private requestTimer: unknown = null;
  private readonly waiters = new Set<() => void>();
  private closed = false;

  constructor(
    private readonly key: string,
    private readonly deps: FeedDeps,
    private readonly url = BYTNODE_WS_URL,
  ) {}

  get state(): FeedState {
    return this.stateNow;
  }

  /** Why live prices are not coming, when they are not. */
  get problem(): string | null {
    return this.problemNow;
  }

  /** The pair's live price: its last trade, while the pair is streamed. */
  last(sym: string): Tick | undefined {
    const s = sym.toUpperCase();
    return this.stateNow === "live" && this.active.has(s) ? this.ticks.get(s) : undefined;
  }

  /** Wants the pair until the returned function is called; `onTick` hears
      each new price. */
  watch(sym: string, onTick?: (t: Tick) => void): () => void {
    const s = sym.toUpperCase();
    this.closed = false;
    this.counts.set(s, (this.counts.get(s) ?? 0) + 1);
    if (onTick) {
      const set = this.watchers.get(s) ?? new Set();
      set.add(onTick);
      this.watchers.set(s, set);
    }
    this.reconcile();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.counts.get(s) ?? 1) - 1;
      if (n > 0) this.counts.set(s, n);
      else this.counts.delete(s);
      if (onTick) this.watchers.get(s)?.delete(onTick);
      this.reconcile();
    };
  }

  /** Wants the pair for `ms` more (at least). */
  lease(sym: string, ms: number): void {
    const s = sym.toUpperCase();
    this.closed = false;
    this.leases.set(s, Math.max(this.leases.get(s) ?? 0, this.deps.now() + ms));
    this.reconcile();
  }

  /** The pair's first live price, if it comes within `ms`. Resolves at once
      when there is one, or when live prices are unavailable. */
  waitFor(sym: string, ms: number): Promise<Tick | undefined> {
    const s = sym.toUpperCase();
    const now = this.last(s);
    if (now || this.stateNow === "unavailable" || this.refused.has(s)) return Promise.resolve(now);
    return new Promise((resolve) => {
      const check = () => {
        const t = this.last(s);
        if (t || this.stateNow === "unavailable" || this.refused.has(s)) finish(t);
      };
      const finish = (t: Tick | undefined) => {
        this.deps.clearTimer(timer);
        this.waiters.delete(check);
        resolve(t);
      };
      const timer = this.deps.setTimer(() => finish(this.last(s)), ms);
      this.waiters.add(check);
    });
  }

  /** Closes (a key no longer in use); wanting a pair again reopens it. */
  close(): void {
    this.closed = true;
    for (const t of [this.reconnectTimer, this.idleTimer, this.sweepTimer]) if (t) this.deps.clearTimer(t);
    this.reconnectTimer = this.idleTimer = this.sweepTimer = null;
    this.drop(1000, "closed");
    this.setState("idle", null);
  }

  /** True while something wants a price. */
  get busy(): boolean {
    return this.wanted().size > 0;
  }

  private wanted(): Set<string> {
    const now = this.deps.now();
    for (const [s, until] of this.leases) if (until <= now) this.leases.delete(s);
    const out = new Set<string>([...this.counts.keys(), ...this.leases.keys()]);
    for (const s of this.refused) out.delete(s);
    return out;
  }

  private setState(state: FeedState, problem: string | null) {
    this.stateNow = state;
    this.problemNow = problem;
    for (const w of [...this.waiters]) w();
  }

  /** Brings the connection and the subscriptions in line with what is
      wanted. */
  private reconcile(): void {
    if (this.closed) return;
    const wanted = this.wanted();
    this.sweep(wanted.size > 0);
    if (!wanted.size) {
      if (this.socket && !this.idleTimer) {
        this.idleTimer = this.deps.setTimer(() => {
          this.idleTimer = null;
          if (!this.wanted().size) {
            this.drop(1000, "idle");
            this.setState("idle", null);
          }
        }, IDLE_MS);
      }
    } else {
      if (this.idleTimer) {
        this.deps.clearTimer(this.idleTimer);
        this.idleTimer = null;
      }
      if (!this.socket) {
        this.open();
        return;
      }
    }
    if (!this.socket || this.socket.readyState !== OPEN || this.pending) return;
    const add = [...wanted].find((s) => !this.active.has(s));
    if (add) return this.request("subscribe", add);
    const remove = [...this.active].find((s) => !wanted.has(s));
    if (remove) this.request("unsubscribe", remove);
  }

  private sweep(on: boolean) {
    if (on && !this.sweepTimer) {
      const tick = () => {
        this.sweepTimer = this.deps.setTimer(tick, SWEEP_MS);
        this.reconcile();
      };
      this.sweepTimer = this.deps.setTimer(tick, SWEEP_MS);
    } else if (!on && this.sweepTimer && !this.leases.size) {
      this.deps.clearTimer(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private request(op: "subscribe" | "unsubscribe", sym: string) {
    this.pending = { op, sym };
    const socket = this.socket;
    this.requestTimer = this.deps.setTimer(() => {
      this.requestTimer = null;
      if (this.socket !== socket || !this.pending) return;
      /* No answer: a half-open connection. Opened again at once. */
      this.drop(4000, "no answer");
      this.notBefore = 0;
      if (this.stateNow === "live") this.setState("connecting", null);
      this.reconcile();
    }, REQUEST_MS);
    try {
      socket?.send(JSON.stringify({ op, channels: [channelOf(sym)] }));
    } catch {
      this.answered();
    }
  }

  /** The request in flight is answered (or given up). */
  private answered() {
    this.pending = null;
    if (this.requestTimer) {
      this.deps.clearTimer(this.requestTimer);
      this.requestTimer = null;
    }
  }

  private open() {
    if (this.reconnectTimer) return;
    const wait = this.notBefore - this.deps.now();
    if (wait > 0) {
      this.reconnectTimer = this.deps.setTimer(() => {
        this.reconnectTimer = null;
        this.reconcile();
      }, wait);
      return;
    }
    if (this.stateNow !== "unavailable") this.setState("connecting", null);
    let socket: SocketLike;
    try {
      socket = this.deps.connect(this.url, this.key);
    } catch (e) {
      this.failed(false, e instanceof Error ? e.message : String(e));
      return;
    }
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      opened = true;
      this.attempt = 0;
      this.active.clear();
      /* A new connection gives every pair its chance again. */
      this.refused.clear();
      this.answered();
      this.setState("live", null);
      this.reconcile();
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.message(ev.data);
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.active.clear();
      this.ticks.clear();
      this.answered();
      if (this.closed) return;
      if (!opened) return void this.failed(true, null);
      if (ev.code === 4003 && /limit/i.test(ev.reason)) {
        this.notBefore = this.deps.now() + LIMIT_RETRY_MS;
        this.setState("unavailable", "BytNode refused the live connection: your plan's number of simultaneous live connections is reached (another app or script uses them).");
      } else {
        /* The six-hour cut (4010): back at once; anything else, after a while. */
        this.notBefore = ev.code === 4010 ? 0 : this.deps.now() + BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)];
        this.setState(this.wanted().size ? "connecting" : "idle", null);
      }
      this.reconcile();
    };
  }

  /** The handshake failed: why (asked once), and when to try again. */
  private failed(handshake: boolean, detail: string | null) {
    this.socket = null;
    const backoff = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)];
    this.notBefore = this.deps.now() + backoff;
    if (!handshake) {
      this.setState("unavailable", detail ? `BytNode's live prices are unreachable: ${detail}` : "BytNode's live prices are unreachable.");
      this.reconcile();
      return;
    }
    void this.deps.probe(this.url, this.key).then((why) => {
      /* A connection opened meanwhile (the probe can be slow) wins. */
      if (this.closed || this.socket) return;
      if (why) this.notBefore = this.deps.now() + REFUSED_RETRY_MS;
      this.setState("unavailable", why ?? "BytNode's live prices are unreachable.");
      this.reconcile();
    });
  }

  private message(raw: unknown) {
    let m: unknown;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (!isRecord(m)) return;
    if (typeof m.channel === "string") {
      const sym = symOf(m.channel);
      const tick = sym ? lastTrade(m.data, timeOf(m.time) ?? this.deps.now()) : null;
      if (!tick) return;
      const before = this.ticks.get(sym);
      if (before && before.at > tick.at) return;
      this.ticks.set(sym, tick);
      for (const fn of this.watchers.get(sym) ?? []) fn(tick);
      for (const w of [...this.waiters]) w();
      return;
    }
    if (m.op === "subscribed" || m.op === "unsubscribed") {
      /* Both answers list every channel still subscribed. */
      if (Array.isArray(m.channels)) {
        this.active.clear();
        for (const c of m.channels) {
          const s = symOf(String(c));
          if (s) this.active.add(s);
        }
      } else if (m.op === "unsubscribed" && this.pending?.op === "unsubscribe") this.active.delete(this.pending.sym);
      this.answered();
      for (const w of [...this.waiters]) w();
      this.reconcile();
      return;
    }
    if (m.op === "error") {
      const code = typeof m.code === "string" ? m.code : "";
      const was = this.pending;
      this.answered();
      if (code === "plan_family" || code === "plan_websocket") {
        this.notBefore = this.deps.now() + REFUSED_RETRY_MS;
        this.drop(1000, "refused");
        this.setState("unavailable", describeRestError(403, null, code, typeof m.message === "string" ? m.message : ""));
        this.reconcile();
        return;
      }
      if (was?.op === "subscribe") {
        this.refused.add(was.sym);
        for (const w of [...this.waiters]) w();
      }
      this.reconcile();
    }
  }

  private drop(code: number, reason: string) {
    const s = this.socket;
    this.socket = null;
    this.active.clear();
    /* A price from a connection that is gone is not live any more. */
    this.ticks.clear();
    this.answered();
    if (s) {
      s.onclose = null;
      try {
        s.close(code, reason);
      } catch {
        /* already gone */
      }
    }
  }
}

/* --- the app's feeds ---------------------------------------------------- */

/** The runtime's WebSocket, the key in the handshake's header (Node's
    WebSocket takes headers; a browser's could not). */
function connectNode(url: string, key: string): SocketLike {
  const Ctor = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => SocketLike;
  return new Ctor(url, { headers: { "X-API-KEY": key } });
}

/** Why the edge refuses the key on this address: a plain GET meets the
    same check as the handshake, and says why in `X-Deny-Reason`. */
async function probeNode(url: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(url.replace(/^ws/, "http"), { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.status !== 401 && res.status !== 403 && res.status !== 429) return null;
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return describeRestError(res.status, res.headers.get("x-deny-reason"), body?.error?.code ?? "", body?.error?.message ?? "");
  } catch {
    return null;
  }
}

const nodeDeps: FeedDeps = {
  connect: connectNode,
  probe: probeNode,
  now: Date.now,
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/* One feed per key, on the server's global (a hot reload must not open a
   second connection). A feed for a key no longer in use closes itself
   once idle; it is forgotten when another key asks. */
const FEEDS = Symbol.for("bytnode-ai.live-feeds");
const store = globalThis as unknown as Record<symbol, Map<string, LiveFeed> | undefined>;

export function liveFeed(apiKey: string): LiveFeed {
  const key = apiKey.trim();
  const feeds = (store[FEEDS] ??= new Map());
  let feed = feeds.get(key);
  if (!feed) {
    for (const [k, f] of feeds) {
      if (!f.busy) {
        f.close();
        feeds.delete(k);
      }
    }
    feed = new LiveFeed(key, nodeDeps);
    feeds.set(key, feed);
  }
  return feed;
}
