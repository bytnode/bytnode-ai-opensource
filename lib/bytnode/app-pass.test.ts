import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The app's BytNode credential: derived from the account session, kept in
   memory, provisioned on the engine by bytnode.com. Nothing real is called. */

const { appPass, appRelay, dropAppPass, isPassLink, passLink, rememberOrigin, resetAppPass, setAccountSession, LINK_ENV } = await import("./app-pass");
const { credentialOf, engineCredential, isEngineCredential } = await import("./engine-credential");
const { APP_PASS, userKey } = await import("./pass-id");
const { isAppRead } = await import("./app-reads");

/* The frozen vector shared with bytnode.com and the engine. */
const SESSION = "bnd_test_session_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const CREDENTIAL = "bne_983yqjU_oxqsZqxXv0vaIN3azMbL4Dciuv2_VMzqYnU";

beforeEach(() => resetAppPass());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the engine credential", () => {
  it("is derived from the session as bytnode.com derives it", () => {
    expect(engineCredential(SESSION)).toBe(CREDENTIAL);
    expect(isEngineCredential(CREDENTIAL)).toBe(true);
    expect(credentialOf(` ${SESSION} `)).toBe(CREDENTIAL);
    expect(credentialOf(CREDENTIAL)).toBe(CREDENTIAL);
    expect(credentialOf("cb_live_x")).toBeNull();
    expect(credentialOf("bne_short")).toBeNull();
    expect(credentialOf(null)).toBeNull();
  });
});

describe("appPass", () => {
  it("the credential of the page's session; the session itself is not kept", async () => {
    setAccountSession(SESSION);
    expect(await appPass()).toEqual({ ok: true, token: CREDENTIAL });
    const slot = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("bytnode-ai.app-pass")];
    expect(JSON.stringify(slot)).not.toContain(SESSION);
  });

  it("a new session replaces the last one; signed out = none", async () => {
    vi.useFakeTimers();
    setAccountSession(SESSION);
    expect(await appPass()).toEqual({ ok: true, token: CREDENTIAL });
    setAccountSession("bnd_page_session_00000000");
    expect(await appPass()).toEqual({ ok: true, token: engineCredential("bnd_page_session_00000000") });
    setAccountSession(null);
    const pending = appPass();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ ok: false, message: expect.stringMatching(/Not signed in to BytNode/) });
  });

  it("signed out: waited for once, then said at once for a while", async () => {
    vi.useFakeTimers();
    const first = appPass();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await first).toMatchObject({ ok: false });
    expect(await appPass()).toMatchObject({ ok: false });
    setAccountSession(SESSION);
    expect(await appPass()).toEqual({ ok: true, token: CREDENTIAL });
  });

  it("waits for the page's first heartbeat", async () => {
    const pending = appPass();
    setAccountSession(SESSION);
    expect(await pending).toEqual({ ok: true, token: CREDENTIAL });
  });

  it("a page that stops speaking is forgotten", async () => {
    vi.useFakeTimers();
    setAccountSession(SESSION, Date.now() - 151_000);
    const pending = appPass();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({ ok: false });
  });

  it("refused by BytNode: not sent again for a while, then again", async () => {
    vi.useFakeTimers();
    setAccountSession(CREDENTIAL);
    dropAppPass(CREDENTIAL);
    expect(await appPass()).toEqual({ ok: false, message: expect.stringMatching(/does not recognise/) });
    vi.advanceTimersByTime(16_000);
    expect(await appPass()).toEqual({ ok: true, token: CREDENTIAL });
  });

  it("in an agent's MCP server: no credential at all, its reads are relayed", async () => {
    vi.stubEnv(LINK_ENV.url, "http://127.0.0.1:3777/api/bytnode/read");
    vi.stubEnv(LINK_ENV.token, "link-secret");
    setAccountSession(CREDENTIAL);
    expect(appRelay()).toEqual({ url: "http://127.0.0.1:3777/api/bytnode/read", token: "link-secret" });
    expect(await appPass()).toMatchObject({ ok: false });
  });
});

describe("what may speak to this server", () => {
  it("the link secret of this server, only", () => {
    rememberOrigin("http://127.0.0.1:3777");
    const link = passLink()!;
    expect(link.url).toBe("http://127.0.0.1:3777/api/bytnode/read");
    expect(isPassLink(link.token)).toBe(true);
    expect(isPassLink("nope")).toBe(false);
    expect(isPassLink(null)).toBe(false);
  });

  it("never a key from outside named like the app's credential", () => {
    expect(userKey(APP_PASS)).toBe("");
    expect(userKey(` ${APP_PASS} `)).toBe("");
    expect(userKey("cb_live_x")).toBe("cb_live_x");
  });

  it("the plugins' reads, and nothing else", () => {
    for (const p of ["/v1/symbols", "/v1/price-change", "/v1/funding/next", "/v1/klines/history", "/v1/liquidations/cumulative/history", "/v1/snapshot"]) expect(isAppRead("GET", p)).toBe(true);
    expect(isAppRead("POST", "/v1/indicators")).toBe(true);
    expect(isAppRead("GET", "/v1/indicators")).toBe(false);
    expect(isAppRead("POST", "/v1/symbols")).toBe(false);
    expect(isAppRead("GET", "/v1/klines")).toBe(false);
    expect(isAppRead("GET", "/v1/symbols/")).toBe(false);
    expect(isAppRead("DELETE", "/v1/symbols")).toBe(false);
    expect(isAppRead("GET", "/mcp")).toBe(false);
  });
});
