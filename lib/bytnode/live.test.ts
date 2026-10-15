import { describe, expect, it } from "vitest";
import { IDLE_MS, LiveFeed, lastTrade, type FeedDeps, type SocketLike } from "./live";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<{ op: string; channels: string[] }> = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(
    readonly url: string,
    readonly key: string,
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code: number, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  /** Answers the last request as the server does: every channel still
      subscribed, for a subscribe and an unsubscribe alike. */
  answer(active: string[]) {
    const last = this.sent.at(-1)!;
    this.receive({ op: last.op === "subscribe" ? "subscribed" : "unsubscribed", channels: active });
  }
}

function world(probe: string | null = null) {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  const sockets: FakeSocket[] = [];
  const deps: FeedDeps = {
    connect: (url, key) => {
      const s = new FakeSocket(url, key);
      sockets.push(s);
      return s;
    },
    probe: async () => probe,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = until;
  };
  return { deps, sockets, advance, timers };
}

/** A frame as the contract (asyncapi 4.3) has it. */
const trade = (sym: string, price: number, time = "2026-10-12T10:00:00.000Z") => ({ channel: `trades.spot.${sym}`, server_time: time, seq: 1, data: [{ time, id: "0123456789abcdef", side: "buy", price, quantity: 1, value_usd: price }] });

describe("lastTrade", () => {
  it("takes the latest trade of a frame", () => {
    expect(lastTrade([{ time: "2026-10-12T10:00:01.000Z", price: 2 }, { time: "2026-10-12T10:00:00.000Z", price: 1 }], 0)).toEqual({ price: 2, at: Date.parse("2026-10-12T10:00:01.000Z") });
    expect(lastTrade([], 0)).toBeNull();
    expect(lastTrade([{ price: "x" }], 0)).toBeNull();
  });
});

describe("LiveFeed", () => {
  it("opens one connection with the key in the handshake, subscribes one pair at a time, streams the last trade", () => {
    const w = world();
    const feed = new LiveFeed("cb_live_k", w.deps, "wss://ws.example/ws");
    const heard: number[] = [];
    feed.watch("btcusdt", (t) => heard.push(t.price));
    feed.lease("ETHUSDT", 60_000);
    expect(w.sockets).toHaveLength(1);
    expect(w.sockets[0].key).toBe("cb_live_k");
    expect(w.sockets[0].url).toBe("wss://ws.example/ws");
    const s = w.sockets[0];
    s.open();
    expect(feed.state).toBe("live");
    expect(s.sent).toEqual([{ op: "subscribe", channels: ["trades.spot.BTCUSDT"] }]);
    s.answer(["trades.spot.BTCUSDT"]);
    expect(s.sent[1]).toEqual({ op: "subscribe", channels: ["trades.spot.ETHUSDT"] });
    s.answer(["trades.spot.BTCUSDT", "trades.spot.ETHUSDT"]);
    s.receive(trade("BTCUSDT", 83_000));
    expect(heard).toEqual([83_000]);
    expect(feed.last("BTCUSDT")?.price).toBe(83_000);
    expect(feed.last("ETHUSDT")).toBeUndefined();
    /* An older frame does not go back in time. */
    s.receive(trade("BTCUSDT", 1, "2026-10-12T09:00:00.000Z"));
    expect(feed.last("BTCUSDT")?.price).toBe(83_000);
  });

  it("lets a pair go when nothing wants it, and closes once idle", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    const stop = feed.watch("BTCUSDT");
    const s = w.sockets[0];
    s.open();
    s.answer(["trades.spot.BTCUSDT"]);
    stop();
    expect(s.sent.at(-1)).toEqual({ op: "unsubscribe", channels: ["trades.spot.BTCUSDT"] });
    s.answer([]);
    expect(s.closed).toBeNull();
    w.advance(IDLE_MS + 1);
    expect(s.closed).not.toBeNull();
    expect(feed.state).toBe("idle");
  });

  it("keeps the other pairs live when one is let go", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    const stop = feed.watch("ETHUSDT");
    const s = w.sockets[0];
    s.open();
    s.answer(["trades.spot.BTCUSDT"]);
    s.answer(["trades.spot.BTCUSDT", "trades.spot.ETHUSDT"]);
    s.receive(trade("BTCUSDT", 5));
    stop();
    s.answer(["trades.spot.BTCUSDT"]);
    expect(feed.last("BTCUSDT")?.price).toBe(5);
    expect(s.sent).toHaveLength(3);
  });

  it("forgets the prices of a connection that is gone", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    const stop = feed.watch("BTCUSDT");
    w.sockets[0].open();
    w.sockets[0].answer(["trades.spot.BTCUSDT"]);
    w.sockets[0].receive(trade("BTCUSDT", 5));
    stop();
    w.sockets[0].answer([]);
    w.advance(IDLE_MS + 1);
    feed.watch("BTCUSDT");
    w.sockets[1].open();
    w.sockets[1].answer(["trades.spot.BTCUSDT"]);
    expect(feed.last("BTCUSDT")).toBeUndefined();
  });

  it("opens again when a request is never answered", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    w.sockets[0].open();
    w.advance(10_000);
    expect(w.sockets[0].closed).not.toBeNull();
    expect(w.sockets).toHaveLength(2);
    w.sockets[1].open();
    expect(w.sockets[1].sent[0]).toEqual({ op: "subscribe", channels: ["trades.spot.BTCUSDT"] });
  });

  it("lets a lease expire", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.lease("BTCUSDT", 60_000);
    const s = w.sockets[0];
    s.open();
    s.answer(["trades.spot.BTCUSDT"]);
    w.advance(90_000);
    expect(s.sent.at(-1)).toEqual({ op: "unsubscribe", channels: ["trades.spot.BTCUSDT"] });
  });

  it("remembers a pair the server refuses, and goes on with the others", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("FOOUSDT");
    feed.watch("BTCUSDT");
    const s = w.sockets[0];
    s.open();
    expect(s.sent[0].channels).toEqual(["trades.spot.FOOUSDT"]);
    s.receive({ op: "error", server_time: "2026-10-15T10:00:00.000Z", error: { code: "invalid_channel", message: "unknown" } });
    expect(s.sent[1].channels).toEqual(["trades.spot.BTCUSDT"]);
  });

  it("stops when the plan refuses the channel's family (the error object nested, contract 3.0.0)", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    const s = w.sockets[0];
    s.open();
    s.receive({ op: "error", server_time: "2026-10-15T10:00:00.000Z", error: { code: "plan_family", message: "Channel 'trades.spot.BTCUSDT' is not in your plan." } });
    expect(feed.state).toBe("unavailable");
    expect(feed.problem).toMatch(/plan does not include this data.*not in your plan/);
    expect(s.closed).not.toBeNull();
  });

  it("takes a key refused on an open session (4001) for a refusal, not a drop", async () => {
    const w = world("Key refused by BytNode: it is missing, invalid or revoked. Check it on bytnode.com.");
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    w.sockets[0].open();
    w.sockets[0].drop(4001, "authentication refused");
    await Promise.resolve();
    await Promise.resolve();
    expect(feed.state).toBe("unavailable");
    expect(feed.problem).toMatch(/Key refused/);
    w.advance(60_000);
    expect(w.sockets).toHaveLength(1);
  });

  it("comes back after a drop, and at once after the six-hour cut", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    w.sockets[0].open();
    w.sockets[0].answer(["trades.spot.BTCUSDT"]);
    w.sockets[0].drop(4010, "session expired");
    expect(w.sockets).toHaveLength(2);
    w.sockets[1].open();
    expect(w.sockets[1].sent[0]).toEqual({ op: "subscribe", channels: ["trades.spot.BTCUSDT"] });
    w.sockets[1].drop(1006);
    expect(w.sockets).toHaveLength(2);
    expect(feed.state).toBe("connecting");
    w.advance(1_000);
    expect(w.sockets).toHaveLength(3);
  });

  it("says why when the handshake is refused, and waits before trying again", async () => {
    const w = world("Your BytNode plan has no live (WebSocket) connection.");
    const feed = new LiveFeed("k", w.deps);
    const first = feed.waitFor("BTCUSDT", 5_000);
    feed.watch("BTCUSDT");
    w.sockets[0].drop(1006);
    await Promise.resolve();
    await Promise.resolve();
    expect(feed.state).toBe("unavailable");
    expect(feed.problem).toMatch(/no live/);
    expect(await first).toBeUndefined();
    w.advance(60_000);
    expect(w.sockets).toHaveLength(1);
    w.advance(5 * 60_000);
    expect(w.sockets).toHaveLength(2);
  });

  it("stops at the plan's connection cap", () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.watch("BTCUSDT");
    w.sockets[0].open();
    w.sockets[0].drop(4003, "limit of 3 simultaneous connections reached");
    expect(feed.state).toBe("unavailable");
    expect(feed.problem).toMatch(/simultaneous live connections/);
    w.advance(30_000);
    expect(w.sockets).toHaveLength(1);
    w.advance(31_000);
    expect(w.sockets).toHaveLength(2);
  });

  it("gives the first live price to whoever waits for it", async () => {
    const w = world();
    const feed = new LiveFeed("k", w.deps);
    feed.lease("BTCUSDT", 60_000);
    const waiting = feed.waitFor("BTCUSDT", 2_500);
    w.sockets[0].open();
    w.sockets[0].answer(["trades.spot.BTCUSDT"]);
    w.sockets[0].receive(trade("BTCUSDT", 42));
    expect((await waiting)?.price).toBe(42);
    const late = feed.waitFor("ETHUSDT", 2_500);
    w.advance(2_500);
    expect(await late).toBeUndefined();
  });
});
