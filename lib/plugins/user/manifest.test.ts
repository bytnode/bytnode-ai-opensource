import { describe, expect, it } from "vitest";
import { isUserPluginId, readUserManifest, userPluginId } from "./manifest";
import { added, covers, describePermissions, EMPTY_PERMISSIONS, hostAllowed, readPermissions } from "./permissions";

const valid = {
  name: "Dividend tracker",
  summary: "Your coming dividends, and what they pay.",
  forAgents: "Tracks the dividends the user expects and tells when the next one is paid.",
  permissions: { network: ["api.example.com"], notify: true },
  config: { currency: { type: "string", title: "Currency", default: "USD", enum: ["USD", "EUR"] } },
  view: { title: "Dividends", description: "The coming payments." },
};

describe("a plugin's id", () => {
  it("is its folder with the u- prefix, never a shipped plugin's", () => {
    expect(userPluginId("dividend-tracker")).toBe("u-dividend-tracker");
    expect(userPluginId("u-dividend-tracker")).toBe("u-dividend-tracker");
    expect(userPluginId("../etc")).toBeNull();
    expect(userPluginId("Watchlist!")).toBeNull();
    expect(isUserPluginId("watchlist")).toBe(false);
    expect(isUserPluginId("u-watchlist")).toBe(true);
  });
});

describe("plugin.json", () => {
  it("becomes an ordinary manifest of tier user, its tab under its own id", () => {
    const r = readUserManifest("u-dividends", valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest).toMatchObject({ id: "u-dividends", tier: "user", category: "tools", version: "1.0.0", requires: [], views: [{ id: "u-dividends", title: "Dividends" }] });
    expect(r.value.permissions).toEqual({ network: ["api.example.com"], bytnode: false, exchange: "none", schedule: false, notify: true });
    expect(r.value.manifest.config.properties.currency.default).toBe("USD");
  });

  it("uses the scheduler optionally when it asks to run on a schedule", () => {
    const r = readUserManifest("u-dividends", { ...valid, permissions: { schedule: true } });
    expect(r.ok && r.value.manifest.optional).toEqual(["scheduler"]);
  });

  it("lists every problem in words the agent can act on", () => {
    const r = readUserManifest("u-x1", { name: "", summary: "s", forAgents: "Tells your balance", permissions: { network: ["https://x.com/api"], exchange: "all" }, color: "red", view: { title: "T" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join("\n");
    expect(text).toMatch(/`name` is required/);
    expect(text).toMatch(/`forAgents` is required/);
    expect(text).toMatch(/not a host name/);
    expect(text).toMatch(/"none", "read" or "orders"/);
    expect(text).toMatch(/Unknown field `color`/);
    expect(text).toMatch(/`view` must be/);
  });

  it('refuses "you"/"your" in what the agents read', () => {
    const r = readUserManifest("u-x1", { ...valid, forAgents: "Tracks your dividends and tells you when the next one is paid." });
    expect(!r.ok && r.errors.join()).toMatch(/never "you"/);
  });

  it("checks each setting against its own schema", () => {
    const r = readUserManifest("u-x1", { ...valid, config: { threshold: { type: "number", title: "Threshold", default: 200, maximum: 100 } } });
    expect(!r.ok && r.errors.join()).toMatch(/config.threshold`.default/);
  });
});

describe("the permissions", () => {
  it("never mean the whole internet: hosts only, subdomains with *.", () => {
    expect(hostAllowed("api.example.com", ["api.example.com"])).toBe(true);
    expect(hostAllowed("evil.com", ["api.example.com"])).toBe(false);
    expect(hostAllowed("api.example.com.evil.com", ["api.example.com"])).toBe(false);
    expect(hostAllowed("a.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(false);
    expect(hostAllowed("badexample.com", ["*.example.com"])).toBe(false);
    expect(readPermissions({ network: ["*"] }).ok).toBe(false);
  });

  it("a grant covers a new version only if it asks for nothing more", () => {
    const granted = { ...EMPTY_PERMISSIONS, network: ["a.com"], exchange: "orders" as const };
    expect(covers(granted, { ...EMPTY_PERMISSIONS, exchange: "read" })).toBe(true);
    expect(covers(granted, { ...EMPTY_PERMISSIONS, network: ["a.com", "b.com"] })).toBe(false);
    expect(covers(granted, { ...EMPTY_PERMISSIONS, notify: true })).toBe(false);
    expect(added(granted, { ...EMPTY_PERMISSIONS, network: ["a.com", "b.com"], notify: true })).toEqual({ ...EMPTY_PERMISSIONS, network: ["b.com"], notify: true });
  });

  it("read in plain words, the order line marked", () => {
    const lines = describePermissions({ network: ["a.com"], bytnode: true, exchange: "orders", schedule: true, notify: true });
    expect(lines.map((l) => l.key)).toEqual(["network", "bytnode", "exchange", "schedule", "notify"]);
    expect(lines.find((l) => l.key === "exchange")).toMatchObject({ danger: true });
    expect(lines[2].text).toMatch(/each one waits for your confirmation/);
    expect(describePermissions(EMPTY_PERMISSIONS)).toEqual([]);
  });
});
