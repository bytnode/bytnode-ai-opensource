import { afterEach, describe, expect, it, vi } from "vitest";

const pass = vi.hoisted(() => ({ appPass: vi.fn(), dropAppPass: vi.fn(), appRelay: vi.fn(() => null as { url: string; token: string } | null) }));
vi.mock("./app-pass", () => ({ APP_PASS: "bytnode-ai:app-pass", LINK_HEADER: "x-bytnode-app-read", appPass: pass.appPass, dropAppPass: pass.dropAppPass, appRelay: pass.appRelay }));

const { BYTNODE_API_URL, appApiUrl, describeRestError, query, restGet, restPost } = await import("./rest");
const { APP_PASS } = await import("./app-pass");

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
    expect(describeRestError(401, "invalid_api_key", "invalid_api_key", "")).toMatch(/Key refused/);
    expect(describeRestError(403, "plan_family", "plan_family", "Open from Traders.")).toMatch(/plan does not include.*Open from Traders/);
    expect(describeRestError(403, null, "history_depth", "limit 24 at most")).toMatch(/beyond your BytNode plan/);
    expect(describeRestError(403, "plan_websocket", "", "")).toMatch(/no live/);
    expect(describeRestError(429, "quota_exceeded", "", "")).toMatch(/monthly quota/);
    expect(describeRestError(429, "rate_limited", "rate_limited", "")).toMatch(/too many requests/);
    expect(describeRestError(422, null, "invalid_symbol", "Unknown symbol FOO.")).toBe("BytNode refused the request: Unknown symbol FOO.");
    expect(describeRestError(503, null, "service_unavailable", "")).toMatch(/HTTP 503/);
  });
});

describe("restGet / restPost", () => {
  it("sends the key in X-API-KEY and opens the envelope", async () => {
    const next = "/v1/klines/history?symbol=BTCUSDT&limit=2&timeframe=1h&before_ms=1&order=desc";
    const fetchMock = vi.fn(async () => reply(200, { status: "ok", data_type: "klines_history", data: [{ time: "t" }], next }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await restGet("cb_test_x", "/v1/klines/history", { symbol: "BTCUSDT", timeframe: "1h", limit: 2 });
    expect(res).toEqual({ ok: true, data: [{ time: "t" }], body: { status: "ok", data_type: "klines_history", data: [{ time: "t" }], next } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BYTNODE_API_URL}/v1/klines/history?symbol=BTCUSDT&timeframe=1h&limit=2`);
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("cb_test_x");
  });

  it("refuses without a key, without calling", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet("  ", "/v1/symbols")).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the edge's reason and the engine's code", async () => {
    vi.stubGlobal("fetch", async () => reply(403, { status: "error", error: { code: "history_depth", message: "At most 24 candles." } }, { "x-deny-reason": "history_depth" }));
    const res = await restGet("k", "/v1/klines/history", { symbol: "BTCUSDT", timeframe: "1h", limit: 300 });
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

const CREDENTIAL = "bne_983yqjU_oxqsZqxXv0vaIN3azMbL4Dciuv2_VMzqYnU";
const urlOf = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[0];
const initOf = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1];

describe("the app's credential", () => {
  it("is sent in X-API-KEY in place of the name that stands for it, to BytNode's host, never after a redirect", async () => {
    pass.appPass.mockResolvedValue({ ok: true, token: CREDENTIAL });
    const fetchMock = vi.fn(async () => reply(200, { status: "ok", data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet(APP_PASS, "/v1/symbols")).toMatchObject({ ok: true });
    expect(urlOf(fetchMock)).toBe(`${appApiUrl()}/v1/symbols`);
    expect((initOf(fetchMock).headers as Record<string, string>)["X-API-KEY"]).toBe(CREDENTIAL);
    expect(initOf(fetchMock).redirect).toBe("error");
  });

  it("refused (not provisioned yet, or revoked): set aside, not sent again at once", async () => {
    pass.appPass.mockReset();
    pass.dropAppPass.mockReset();
    pass.appPass.mockResolvedValue({ ok: true, token: CREDENTIAL });
    const fetchMock = vi.fn(async () => reply(401, { status: "error", error: { code: "invalid_api_key", message: "" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet(APP_PASS, "/v1/symbols")).toMatchObject({ ok: false, status: 401 });
    expect(pass.dropAppPass).toHaveBeenCalledWith(CREDENTIAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("not to be had: said, and BytNode is not called", async () => {
    pass.appPass.mockResolvedValue({ ok: false, message: "Not signed in to BytNode: sign in to read market data." });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet(APP_PASS, "/v1/symbols")).toEqual({ ok: false, status: 401, code: "no_app_access", message: "Not signed in to BytNode: sign in to read market data." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens only the plugins' reads: anything else is refused before it is sent", async () => {
    pass.appPass.mockResolvedValue({ ok: true, token: CREDENTIAL });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await restGet(APP_PASS, "/v1/klines", { symbol: "BTCUSDT" })).toMatchObject({ ok: false, status: 403, code: "not_an_app_read" });
    expect(await restPost(APP_PASS, "/v1/symbols", {})).toMatchObject({ ok: false, code: "not_an_app_read" });
    expect(await restGet(APP_PASS, "/v1/indicators")).toMatchObject({ ok: false, code: "not_an_app_read" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in an agent's MCP server: relayed through BytNode-AI, which holds the credential", async () => {
    pass.appPass.mockReset();
    pass.appRelay.mockReturnValue({ url: "http://127.0.0.1:3777/api/bytnode/read", token: "link-secret" });
    const fetchMock = vi.fn(async () => reply(200, { ok: true, data: [1], body: { status: "ok", data: [1] } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await restGet(APP_PASS, "/v1/funding/next", { symbol: "BTCUSDT" })).toEqual({ ok: true, data: [1], body: { status: "ok", data: [1] } });
      expect(urlOf(fetchMock)).toBe("http://127.0.0.1:3777/api/bytnode/read");
      expect((initOf(fetchMock).headers as Record<string, string>)["x-bytnode-app-read"]).toBe("link-secret");
      expect(JSON.parse(String(initOf(fetchMock).body))).toEqual({ method: "GET", path: "/v1/funding/next", params: { symbol: "BTCUSDT" } });
      expect(pass.appPass).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(reply(200, { ok: false, status: 429, code: "rate_limited", message: "Too many." }));
      expect(await restGet(APP_PASS, "/v1/symbols")).toEqual({ ok: false, status: 429, code: "rate_limited", message: "Too many." });
    } finally {
      pass.appRelay.mockReturnValue(null);
    }
  });

  it("goes to BytNode's own host in a production build, whatever the environment says", () => {
    expect(appApiUrl({ BYTNODE_API_URL: "http://127.0.0.1:9999" }, true)).toBe("https://api.bytnode.com");
    expect(appApiUrl({ BYTNODE_API_URL: "http://127.0.0.1:9999/" }, false)).toBe("http://127.0.0.1:9999");
    expect(appApiUrl({}, false)).toBe("https://api.bytnode.com");
  });
});
