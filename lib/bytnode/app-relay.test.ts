import { beforeEach, describe, expect, it, vi } from "vitest";

/* The relay an agent's MCP server reads BytNode through: the link secret,
   the plugins' reads only, the data back — never a key. */

const rest = vi.hoisted(() => ({ appRead: vi.fn() }));
vi.mock("./rest", () => ({ appRead: rest.appRead }));

const { passLink, rememberOrigin } = await import("./app-pass");
const { relayRead } = await import("./app-relay");

rememberOrigin("http://127.0.0.1:3777");
const LINK = passLink()!.token;

beforeEach(() => {
  rest.appRead.mockReset();
  rest.appRead.mockResolvedValue({ ok: true, data: [1], body: { status: "ok", data: [1] } });
});

describe("relayRead", () => {
  it("reads for the caller with the link secret, and answers with the data", async () => {
    const r = await relayRead(LINK, { method: "GET", path: "/v1/snapshot", params: { symbol: "BTCUSDT", "klines@1h": 24, tokenomics: true } });
    expect(r).toEqual({ status: 200, body: { ok: true, data: [1], body: { status: "ok", data: [1] } } });
    expect(rest.appRead).toHaveBeenCalledWith("GET", "/v1/snapshot", { symbol: "BTCUSDT", "klines@1h": 24, tokenomics: true }, undefined, undefined);
    await relayRead(LINK, { method: "POST", path: "/v1/indicators", body: { symbol: "BTCUSDT" } });
    expect(rest.appRead).toHaveBeenLastCalledWith("POST", "/v1/indicators", undefined, { symbol: "BTCUSDT" }, undefined);
  });

  it("refuses a caller without the secret", async () => {
    expect(await relayRead(null, { method: "GET", path: "/v1/symbols" })).toEqual({ status: 403, body: { message: "Refused." } });
    expect(await relayRead("guess", { method: "GET", path: "/v1/symbols" })).toMatchObject({ status: 403 });
    expect(rest.appRead).not.toHaveBeenCalled();
  });

  it("refuses what is not one of the plugins' reads, or not readable", async () => {
    for (const raw of [
      { method: "GET", path: "/v1/klines" },
      { method: "POST", path: "/v1/symbols" },
      { method: "DELETE", path: "/v1/symbols" },
      { method: "GET", path: "https://elsewhere.example/v1/symbols" },
      { method: "GET", path: "/v1/symbols", params: { x: { nested: 1 } } },
      { method: "GET", path: "/v1/symbols", params: [1] },
    ]) {
      expect(await relayRead(LINK, raw)).toMatchObject({ status: 403 });
    }
    expect(await relayRead(LINK, "nope")).toMatchObject({ status: 400 });
    expect(rest.appRead).not.toHaveBeenCalled();
  });
});
