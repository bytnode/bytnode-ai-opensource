import { describe, expect, it } from "vitest";
import type { PluginsState } from "@/lib/domain/plugins";
import { enabledPlugins, pluginSettings, pluginsForAgent, resolveConfig, setPluginAgents, setPluginConfig, togglePlugin, validValue } from "./state";
import { manifest } from "./test-fixture";

const catalog = [
  manifest("scheduler", [], [], { tick: { type: "string", title: "Tick", default: "every minute", format: "frequency" } }),
  manifest("watchlist"),
  manifest("alerts", ["scheduler", "watchlist"]),
  manifest("portfolio", [], ["scheduler"], {
    currency: { type: "string", title: "Currency", default: "USD", enum: ["USD", "EUR", "CHF"] },
    at: { type: "string", title: "Snapshot", default: "23:55", format: "time" },
    keep: { type: "integer", title: "Keep", default: 365, minimum: 30, maximum: 3650 },
    live: { type: "boolean", title: "Live", default: true },
  }),
];

describe("plugin settings", () => {
  it("a plugin absent from the settings is on, with its defaults, for every agent", () => {
    expect(pluginSettings({}, "watchlist")).toEqual({ enabled: true, config: {}, agentIds: null });
    expect(enabledPlugins(catalog, {})).toEqual(["scheduler", "watchlist", "alerts", "portfolio"]);
  });

  it("checks every stored value against the schema", () => {
    const p = catalog[3];
    expect(resolveConfig(p, { currency: "CHF", at: "08:15", keep: 90, live: false, extra: "x" })).toEqual({ currency: "CHF", at: "08:15", keep: 90, live: false });
    expect(resolveConfig(p, { currency: "GBP", at: "8h", keep: 12.5, live: "yes" as unknown as boolean })).toEqual({ currency: "USD", at: "23:55", keep: 365, live: true });
    expect(resolveConfig(p, undefined)).toEqual({ currency: "USD", at: "23:55", keep: 365, live: true });
  });

  it("validates frequencies and bounds", () => {
    const tick = catalog[0].config.properties.tick;
    expect(validValue(tick, "every 5 minutes")).toBe(true);
    expect(validValue(tick, "sometimes")).toBe(false);
    const keep = catalog[3].config.properties.keep;
    expect(validValue(keep, 10)).toBe(false);
    expect(validValue(keep, 4000)).toBe(false);
  });

  it("a plugin whose requirement is off does not run", () => {
    const state: PluginsState = { scheduler: { enabled: false, config: {}, agentIds: null } };
    expect(enabledPlugins(catalog, state)).toEqual(["watchlist", "portfolio"]);
  });

  it("an agent gets the running plugins that allow it", () => {
    const state = setPluginAgents({}, "watchlist", ["a1"]);
    expect(pluginsForAgent(catalog, state, "a1")).toContain("watchlist");
    expect(pluginsForAgent(catalog, state, "a2")).not.toContain("watchlist");
    expect(pluginsForAgent(catalog, setPluginAgents(state, "watchlist", null), "a2")).toContain("watchlist");
  });
});

describe("togglePlugin", () => {
  it("turning one off turns off what requires it", () => {
    const { state, also } = togglePlugin(catalog, {}, "scheduler", false);
    expect(also).toEqual(["alerts"]);
    expect(state.scheduler.enabled).toBe(false);
    expect(state.alerts.enabled).toBe(false);
    expect(state.portfolio).toBeUndefined();
  });

  it("turning one on turns on what it requires, and says which", () => {
    const off: PluginsState = {
      scheduler: { enabled: false, config: { tick: "every 5 minutes" }, agentIds: null },
      alerts: { enabled: false, config: {}, agentIds: ["a1"] },
    };
    const { state, also } = togglePlugin(catalog, off, "alerts", true);
    expect(also).toEqual(["scheduler"]);
    expect(state.alerts).toEqual({ enabled: true, config: {}, agentIds: ["a1"] });
    expect(state.scheduler).toEqual({ enabled: true, config: { tick: "every 5 minutes" }, agentIds: null });
  });

  it("changes one setting and keeps the rest", () => {
    const state = setPluginConfig(setPluginConfig({}, "portfolio", "currency", "EUR"), "portfolio", "keep", 90);
    expect(state.portfolio).toEqual({ enabled: true, config: { currency: "EUR", keep: 90 }, agentIds: null });
  });
});
