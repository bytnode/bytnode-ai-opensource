import { beforeEach, describe, expect, it, vi } from "vitest";

/* The two roads of the price layer: the app reads BytNode's REST API and
   WebSocket, an AI agent (a plugin's tool) its MCP tools. Nothing real is
   called. */

const rest = vi.hoisted(() => ({ restGet: vi.fn() }));
const mcp = vi.hoisted(() => ({ readBytnodeTool: vi.fn() }));
const feed = vi.hoisted(() => ({ last: vi.fn(), waitFor: vi.fn(), lease: vi.fn() }));

vi.mock("@/lib/bytnode/rest", () => ({ restGet: rest.restGet }));
vi.mock("@/lib/mcp/bytnode", () => ({ readBytnodeTool: mcp.readBytnodeTool }));
vi.mock("@/lib/bytnode/live", () => ({ liveFeed: () => feed }));

const { asAgent } = await import("@/lib/bytnode/reader");
const { candles, fundingRate, quote, withLive } = await import("./prices");

const SYMBOLS = [{ symbol: "BTCUSDT", base_asset: "BTC", name: "Bitcoin" }];
const PRICE_CHANGE = { time: "2026-10-12T10:00:00.000Z", price: 100, changes_pct: { "1h": 0, "4h": 0, "1d": 25, "1w": -50 } };

let n = 0;
/* Each test its own key: the layer's caches are per key. */
const key = () => `cb_test_${++n}`;

beforeEach(() => {
  rest.restGet.mockReset();
  mcp.readBytnodeTool.mockReset();
  feed.last.mockReset();
  feed.waitFor.mockReset();
  feed.lease.mockReset();
  rest.restGet.mockImplementation(async (_k: string, path: string) => {
    if (path === "/v1/symbols") return { ok: true, data: SYMBOLS, body: {} };
    if (path === "/v1/price-change") return { ok: true, data: PRICE_CHANGE, body: {} };
    if (path === "/v1/funding/next") return { ok: true, data: { time: "t", estimated_rate_pct: 0.0039, apr_pct: 4.27 }, body: {} };
    if (path === "/v1/klines/history")
      return {
        ok: true,
        data: [
          { time: "2026-10-12T09:00:00.000Z", open: 2, high: 3, low: 1, close: 2, volume: 10, is_closed: true },
          { time: "2026-10-12T08:00:00.000Z", open: 1, high: 2, low: 1, close: 2, volume: 5, is_closed: true },
        ],
        body: {},
      };
    return { ok: false, status: 404, code: "", message: "unknown" };
  });
});

describe("the app's road", () => {
  it("prices live: the WebSocket's last trade, the changes worked out against the REST reading", async () => {
    feed.last.mockReturnValue({ price: 110, at: Date.parse("2026-10-12T10:00:05.000Z") });
    const q = await quote("BTC/USDT", { bytnodeKey: key() });
    expect(q).toMatchObject({ symbol: "BTC/USDT", price: 110, source: "bytnode", at: "2026-10-12T10:00:05.000Z" });
    /* 24 h ago: 100 / 1.25 = 80 → 110 is +37.5 %. */
    expect("change24h" in q && q.change24h).toBeCloseTo(37.5);
    expect(feed.lease).toHaveBeenCalledWith("BTCUSDT", expect.any(Number));
    expect(mcp.readBytnodeTool).not.toHaveBeenCalled();
  });

  it("falls back on the REST reading when no live price comes", async () => {
    feed.last.mockReturnValue(undefined);
    feed.waitFor.mockResolvedValue(undefined);
    const q = await quote("BTC/USDT", { bytnodeKey: key() });
    expect(q).toMatchObject({ price: 100, change24h: 25, change7d: -50, at: "2026-10-12T10:00:00.000Z" });
  });

  it("does not ask BytNode for a pair it does not cover", async () => {
    const q = await quote("PEPE/USDT", { bytnodeKey: key() });
    expect(q).toMatchObject({ error: expect.stringMatching(/BytNode does not cover it/) });
    expect(feed.lease).not.toHaveBeenCalled();
  });

  it("reads candles and the funding from REST", async () => {
    const k = key();
    const c = await candles("BTC/USDT", "1h", 2, { bytnodeKey: k });
    expect(c).toMatchObject({ source: "bytnode" });
    expect("candles" in c && c.candles.map((x) => [x.t, x.v])).toEqual([
      [Date.parse("2026-10-12T08:00:00.000Z"), 5],
      [Date.parse("2026-10-12T09:00:00.000Z"), 10],
    ]);
    expect(rest.restGet).toHaveBeenCalledWith(k, "/v1/klines/history", { symbol: "BTCUSDT", timeframe: "1h", limit: 10 });
    expect(await fundingRate("BTC/USDT", { bytnodeKey: k })).toBeCloseTo(0.0039);
  });

  it("reads candles up to the plan's history window when the limit goes past it", async () => {
    const k = key();
    const fallback = rest.restGet.getMockImplementation()!;
    rest.restGet.mockImplementation(async (kk: string, path: string, params: Record<string, unknown>) =>
      path === "/v1/klines/history" && params.limit ? { ok: false, status: 403, code: "history_depth", message: "This history goes beyond your BytNode plan." } : fallback(kk, path, params),
    );
    const c = await candles("BTC/USDT", "1d", 400, { bytnodeKey: k });
    expect("candles" in c && c.candles).toHaveLength(2);
    expect(rest.restGet).toHaveBeenLastCalledWith(k, "/v1/klines/history", { symbol: "BTCUSDT", timeframe: "1d" });
  });
});

describe("an agent's road", () => {
  it("prices through the MCP tools, never REST or the WebSocket", async () => {
    mcp.readBytnodeTool.mockResolvedValue({ ok: true, text: JSON.stringify({ mode: "latest", data: { price_change: PRICE_CHANGE } }) });
    const q = await asAgent(() => quote("BTC/USDT", { bytnodeKey: key() }));
    expect(q).toMatchObject({ price: 100, change24h: 25 });
    expect(mcp.readBytnodeTool).toHaveBeenCalledWith(expect.any(String), "get_market_data", { symbol: "BTCUSDT", price_change: true }, expect.anything());
    expect(rest.restGet).not.toHaveBeenCalled();
    expect(feed.lease).not.toHaveBeenCalled();
  });

  it("says a plan's refusal, and leaves a pair BytNode does not serve to the exchanges", async () => {
    mcp.readBytnodeTool.mockResolvedValue({ ok: false, message: "Error (HTTP 403): Your plan does not include this data family." });
    expect(await asAgent(() => quote("ETH/USDT", { bytnodeKey: key() }))).toMatchObject({ error: expect.stringMatching(/HTTP 403/) });
    mcp.readBytnodeTool.mockResolvedValue({ ok: false, message: "Error (HTTP 422): The symbol is not served." });
    expect(await asAgent(() => quote("PEPE/USDT", { bytnodeKey: key() }))).toMatchObject({ error: expect.stringMatching(/BytNode does not cover it/) });
  });

  it("asks candles with the MCP's klines + timeframe", async () => {
    mcp.readBytnodeTool.mockResolvedValue({ ok: true, text: JSON.stringify({ data: { "klines@4h": [{ time: "2026-10-12T08:00:00.000Z", open: 1, high: 2, low: 1, close: 2 }] } }) });
    const c = await asAgent(() => candles("BTC/USDT", "4h", 50, { bytnodeKey: key() }));
    expect(c).toMatchObject({ source: "bytnode" });
    expect(mcp.readBytnodeTool).toHaveBeenCalledWith(expect.any(String), "get_market_data", { symbol: "BTCUSDT", klines: 50, timeframe: "4h" }, expect.anything());
  });
});

describe("withLive", () => {
  it("leaves a change it cannot carry unknown", () => {
    const q = withLive({ symbol: "X/USDT", price: 10, change1h: undefined, change24h: -100, source: "bytnode", at: "t" }, { price: 11, at: 0 });
    expect(q.change1h).toBeUndefined();
    expect(q.change24h).toBeUndefined();
  });
});
