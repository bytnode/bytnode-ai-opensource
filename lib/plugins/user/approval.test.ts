import { describe, expect, it } from "vitest";
import { ApprovalKeyHolder, VERIFIED_GRANTS_ENV, isTrustedGrant, signGrant, verifyGrant } from "./approval";
import { EMPTY_PERMISSIONS, type Grant } from "./permissions";

/* ⚠️ An agent with a shell forged the review screen's headers and got its
   own plugin activated. What it cannot forge: the key only the user's
   browser holds — approvals are signed with it, and checked when plugins
   load. */

const KEY = "cd".repeat(32);
const OTHER = "ef".repeat(32);
const perms = { ...EMPTY_PERMISSIONS, network: ["api.example.com"], notify: true };
const grant = (over: Partial<Grant> = {}): Grant => ({ permissions: perms, accounts: [], digest: "d1", at: "2026-09-28", ...over });

describe("signed approvals", () => {
  it("verify for the plugin and the permissions that were approved", () => {
    const sig = signGrant(KEY, "u-a", grant());
    expect(verifyGrant(KEY, "u-a", grant({ sig }))).toBe(true);
    /* New code under the same rights keeps the approval (live updates). */
    expect(verifyGrant(KEY, "u-a", grant({ sig, digest: "d2", at: "later" }))).toBe(true);
  });

  it("do not verify: no signature, another key, another plugin, widened rights", () => {
    const sig = signGrant(KEY, "u-a", grant());
    expect(verifyGrant(KEY, "u-a", grant())).toBe(false);
    expect(verifyGrant(OTHER, "u-a", grant({ sig }))).toBe(false);
    expect(verifyGrant(KEY, "u-b", grant({ sig }))).toBe(false);
    expect(verifyGrant(KEY, "u-a", grant({ sig, permissions: { ...perms, exchange: "orders" } }))).toBe(false);
    expect(verifyGrant(KEY, "u-a", grant({ sig, accounts: ["acc-1"] }))).toBe(false);
  });
});

describe("the browser's key, in the server's memory", () => {
  it("the first key is registered; another is refused while it is alive", () => {
    const h = new ApprovalKeyHolder();
    expect(h.register(KEY, 0)).toBe(true);
    expect(h.register(OTHER, 1_000)).toBe(false);
    expect(h.register("", 1_000)).toBe(false);
    expect(h.register(KEY, 2_000)).toBe(true);
    expect(h.matches(KEY)).toBe(true);
    expect(h.matches(OTHER)).toBe(false);
    expect(h.matches(null)).toBe(false);
  });

  it("a key whose tab stopped speaking may be replaced (browser data cleared)", () => {
    const h = new ApprovalKeyHolder();
    h.register(KEY, 0);
    expect(h.register(OTHER, 10 * 60_000)).toBe(true);
    expect(h.current()).toBe(OTHER);
  });

  it("nothing but a 64-hex key is accepted", () => {
    expect(new ApprovalKeyHolder().register("not-a-key")).toBe(false);
  });
});

describe("an MCP server trusts only what the Next server verified", () => {
  it("reads the verified signatures from its environment, never a key", () => {
    const sig = signGrant(KEY, "u-a", grant());
    const env = { [VERIFIED_GRANTS_ENV]: JSON.stringify({ "u-a": sig }) };
    expect(isTrustedGrant("u-a", grant({ sig }), env)).toBe(true);
    expect(isTrustedGrant("u-a", grant({ sig: "forged" }), env)).toBe(false);
    expect(isTrustedGrant("u-b", grant({ sig }), env)).toBe(false);
    expect(isTrustedGrant("u-a", grant({ sig }), { [VERIFIED_GRANTS_ENV]: "" })).toBe(false);
  });
});
