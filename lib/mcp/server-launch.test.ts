import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleIsUsable, financeServerArgs, SERVER_BUNDLE } from "./server-launch";

describe("bundleIsUsable (P1-10: the finance server from an installed package)", () => {
  it("never in development: tsx runs the source, which changes under our feet", () => {
    expect(bundleIsUsable({ production: false, bundleMtime: 2_000, buildMtime: 1_000 })).toBe(false);
  });
  it("in production, when the bundle is there and not older than the build", () => {
    expect(bundleIsUsable({ production: true, bundleMtime: null, buildMtime: 1_000 })).toBe(false);
    expect(bundleIsUsable({ production: true, bundleMtime: 2_000, buildMtime: 1_000 })).toBe(true);
    /* npm stamps every file of a package with the same date. */
    expect(bundleIsUsable({ production: true, bundleMtime: 499_162_500_000, buildMtime: 499_162_500_000 })).toBe(true);
    expect(bundleIsUsable({ production: true, bundleMtime: 2_000, buildMtime: null })).toBe(true);
  });
  it("not a bundle left by an old pack after a newer build", () => {
    expect(bundleIsUsable({ production: true, bundleMtime: 1_000, buildMtime: 60_000 })).toBe(false);
  });
});

describe("financeServerArgs", () => {
  it("falls back to tsx on the source when there is no bundle", () => {
    const root = path.join("C:", "nowhere", "bytnode-ai");
    const args = financeServerArgs(root, true);
    expect(args.slice(-3)).toEqual(["--tsconfig", path.join(root, "tsconfig.json"), path.join(root, "lib", "mcp", "finance-server.ts")]);
    expect(SERVER_BUNDLE).toBe(path.join(".next", "finance-server.mjs"));
  });
});
