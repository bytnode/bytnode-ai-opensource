import { describe, expect, it } from "vitest";
import { accountOf, accountUrls, challengeOf, deviceName, doneUrl, errorOf, pkcePair, randomState, readCallback, signInUrl } from "./flow";

describe("the BytNode account sign-in", () => {
  it("bytnode.com by default, a local app_web when told", () => {
    expect(accountUrls({})).toEqual({ site: "https://bytnode.com", api: "https://bytnode.com/api" });
    expect(accountUrls({ BYTNODE_AI_ACCOUNT_URL: "http://localhost:3000/", BYTNODE_AI_ACCOUNT_API: "http://localhost:4000/api" })).toEqual({
      site: "http://localhost:3000",
      api: "http://localhost:4000/api",
    });
  });

  it("PKCE: the challenge is the S256 of the verifier (RFC 7636, appendix B)", () => {
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const p = pkcePair();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(challengeOf(p.verifier));
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("the page's address carries the challenge, the port and the state", () => {
    const u = new URL(signInUrl("https://bytnode.com", { challenge: "c".repeat(43), port: 51234, state: "s".repeat(32) }));
    expect(u.origin + u.pathname).toBe("https://bytnode.com/auth/desktop");
    expect(Object.fromEntries(u.searchParams)).toEqual({ challenge: "c".repeat(43), port: "51234", state: "s".repeat(32) });
    expect(doneUrl("https://bytnode.com", true)).toBe("https://bytnode.com/auth/desktop?done=1");
  });

  it("the callback: only ours, with our state, and a well-formed code", () => {
    const state = "s".repeat(32);
    const code = "A".repeat(43);
    expect(readCallback(`/callback?code=${code}&state=${state}`, state)).toEqual({ kind: "code", code });
    /* Anything else on this machine may call the port: never an end to the sign-in. */
    expect(readCallback(`/callback?code=${code}&state=other`, state)).toEqual({ kind: "ignore" });
    expect(readCallback(`/favicon.ico`, state)).toEqual({ kind: "ignore" });
    expect(readCallback(`/callback?code=short&state=${state}`, state)).toEqual({ kind: "ignore" });
    expect(readCallback(`/callback?error=denied&state=${state}`, state)).toEqual({ kind: "error", message: "denied" });
  });

  it("names the device without saying more than the OS and the machine's name", () => {
    expect(deviceName("win32", "DESKTOP-1")).toBe("BytNode-AI on Windows (DESKTOP-1)");
    expect(deviceName("darwin", "")).toBe("BytNode-AI on macOS");
  });

  it("reads the API's error envelope and account", () => {
    expect(errorOf({ error: { code: "desktop_grant_invalid", message: "Expired." } }, 400)).toEqual({ code: "desktop_grant_invalid", message: "Expired." });
    expect(errorOf(null, 401)).toEqual({ code: "unauthorized", message: "bytnode.com answered 401." });
    expect(accountOf({ email: "a@b.c", name: " Ada ", avatar_url: null })).toEqual({ email: "a@b.c", name: "Ada", avatarUrl: null });
    expect(accountOf({ name: "x" })).toBeNull();
  });
});
