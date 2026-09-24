import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_MANIFESTS } from "./catalog";
import { PLUGINS } from "./definitions";
import { startOrder } from "./core/graph";
import { validValue } from "./core/state";

describe("the shipped plugins", () => {
  it("the catalog and the server side list the same plugins, same manifests", () => {
    expect(PLUGINS.map((p) => p.manifest)).toEqual(PLUGIN_MANIFESTS);
  });

  it("form a valid graph with unique ids and unique views", () => {
    expect(() => startOrder(PLUGIN_MANIFESTS)).not.toThrow();
    const ids = PLUGIN_MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const views = PLUGIN_MANIFESTS.flatMap((m) => m.views.map((v) => v.id));
    expect(new Set(views).size).toBe(views.length);
    for (const m of PLUGIN_MANIFESTS) for (const dep of m.optional) expect(ids).toContain(dep);
  });

  it("each tells the agents what it is for, in full sentences about the user", () => {
    for (const m of PLUGIN_MANIFESTS) {
      expect(m.forAgents.length, m.id).toBeGreaterThan(40);
      expect(m.forAgents, m.id).toMatch(/\.$/);
      /* `summary` speaks to the user ("your…"); in a prompt, "your" would be the agent's. */
      expect(m.forAgents, m.id).not.toMatch(/\byour\b/i);
    }
  });

  it("every default configuration value is valid for its own schema", () => {
    for (const m of PLUGIN_MANIFESTS) {
      for (const [key, prop] of Object.entries(m.config.properties)) expect(validValue(prop, prop.default), `${m.id}.${key}`).toBe(true);
    }
  });
});

/* ⚠️ THE GUARANTEE, CHECKED ON THE SOURCES. No plugin may place, cancel or
   close an order, move funds or change leverage on its own: it can only
   park a call through `ctx.confirm`, which the user decides. So no plugin
   file imports the exchange action tools, and none calls the ccxt methods
   that act on an account. */
describe("no plugin acts on an exchange account by itself", () => {
  const root = path.join(__dirname);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !p.includes(`${path.sep}core${path.sep}`)) files.push(p);
    }
  };
  walk(root);

  it.each(files.map((f) => [path.relative(root, f), f]))("%s", (_name, file) => {
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toMatch(/tools\/exchange\/(place-order|cancel-order|close-position|transfer|set-leverage)/);
    expect(text).not.toMatch(/\.(createOrder|cancelOrder|cancelAllOrders|withdraw|transfer|setLeverage|setMarginMode)\s*\(/);
  });
});
