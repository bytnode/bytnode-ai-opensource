import { afterEach, describe, expect, it, vi } from "vitest";
import { BYTNODE_API_URL, describeRestError, query, restGet, restPost } from "./rest";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("query", () => {
  it("sends true as 1 and leaves empty values out", () => {
    expect(query({ symbol: "BTCUSDT", "klines@1h": 24, tokenomics: true, x: false, y: undefined, z: null, w: "" })).toBe("?symbol=BTCUSDT&klines%401h=24&tokenomics=1");
    expect(query({})).toBe("");
  });
});

describe("describeRestError", () => {
  it("tells each refusal in plain English", () => {
    expect(describeRestError(401, "key", "invalid_api_key", "")).toMatch(/Key refused/);
    expect(describeRestError(403, "family", "plan_family", "Open from Traders.")).toMatch(/plan does not include.*Open from Traders/);
    expect(describeRestError(403, "depth", "history_depth", "limit 24 at most")).toMatch(/beyond your BytNode plan/);
    expect(describeRestError(403, "websocket", "plan_websocket", "")).toMatch(/no live/);
    expect(describeRestError(429, "quota", "quota_exceeded", "")).toMatch(/monthly quota/);
    expect(describeRestError(429, "rate", "rate_limited", "")).toMatch(/too many requests/);
    expect(describeRestError(422, null, "invalid_symbol", "Unknown symbol FOO.")).toBe("BytNode refused the request: Unknown symbol FOO.");
    expect(describeRestError(503, null, "service_unavailable", "")).toMatch(/HTTP 503/);
  });
});

describe("restGet / restPost", () => {
  it("sends the key in X-API-KEY and opens the envelope", async () => {
    const fetchMock = vi.fn(async () => reply(200, { status: "ok", data_type: "klines", data: [{ time: "t" }], next: { before_ms: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await restGet("cb_test_x", "/v1/klines", { symbol: "BTCUSDT", timeframe: "1h", limit: 2 });
    expect(res).toEqual({ ok: true, data: [{ time: "t" }], body: { status: "ok", data_type: "klines", data: [{ time: "t" }], next: { before_ms: 1 } } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BYTNODE_API_URL}/v1/klines?symbol=BTCUSDT&timeframe=1h&limit=2`);
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("cb_test_x");
  });

  it("refuses without a key, without calling", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet("  ", "/v1/symbols")).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the edge's reason and the engine's code", async () => {
    vi.stubGlobal("fetch", async () => reply(403, { status: "error", error: { code: "history_depth", message: "At most 24 candles." } }, { "x-deny-reason": "depth" }));
    const res = await restGet("k", "/v1/klines", { symbol: "BTCUSDT", timeframe: "1h", limit: 300 });
    expect(res).toMatchObject({ ok: false, status: 403, code: "history_depth" });
    expect(!res.ok && res.message).toMatch(/beyond your BytNode plan.*At most 24/);
  });

  it("tries a GET once more after a gateway error, never a POST", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (++n === 1 ? reply(503, { status: "error", error: { code: "service_unavailable", message: "" } }) : reply(200, { status: "ok", data: 1 })));
    expect(await restGet("k", "/v1/symbols")).toMatchObject({ ok: true, data: 1 });
    expect(n).toBe(2);
    n = 0;
    expect(await restPost("k", "/v1/indicators", { symbol: "BTCUSDT" })).toMatchObject({ ok: false, status: 503 });
    expect(n).toBe(1);
  });

  it("sends a POST's body as JSON", async () => {
    const fetchMock = vi.fn(async () => reply(200, { status: "ok", data: { indicators: {} } }));
    vi.stubGlobal("fetch", fetchMock);
    await restPost("k", "/v1/indicators", { symbol: "BTCUSDT", timeframe: "1h", indicators: [] });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ symbol: "BTCUSDT", timeframe: "1h", indicators: [] });
  });

  it("says BytNode is unreachable when the network fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.bytnode.com") });
    });
    const res = await restGet("k", "/v1/symbols");
    expect(!res.ok && res.message).toMatch(/unreachable: getaddrinfo ENOTFOUND/);
  });
});
