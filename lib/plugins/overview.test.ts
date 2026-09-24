import { describe, expect, it } from "vitest";
import type { Confirmation, PluginsState } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import type { PluginDefinition } from "./core/contract";
import { PluginRuntime, type RuntimeEnv } from "./core/runtime";
import type { PluginStore } from "./core/store";
import { manifest } from "./core/test-fixture";
import { pluginPrompt } from "./extras";
import { pluginsPrompt, type PluginEntry } from "./overview";

const watchlist: PluginEntry = {
  name: "Watchlist",
  about: "The list of assets the user follows.",
  tools: ["WatchlistShow", "WatchlistEdit"],
  tabs: ["Watchlist"],
  context: ["## Watchlist\nBTC/USDT, ETH/USDT."],
};

describe("pluginsPrompt: a main agent", () => {
  const text = pluginsPrompt({
    engine: "mcp",
    subagent: false,
    on: [watchlist],
    absent: [
      { name: "Alerts", about: "Notifies the user.", why: { kind: "off" } },
      { name: "Portfolio", about: "The user's holdings.", why: { kind: "need", need: "exchange-account" } },
      { name: "DCA", about: "Recurring purchases.", why: { kind: "failed", message: "bad config" } },
    ],
  });

  it("says what a plugin is, and is not", () => {
    expect(text).toMatch(/^## Your BytNode-AI plugins/);
    expect(text).toContain("Settings → Plugins");
    expect(text).toContain("not skills, not MCP servers, and not the plugins or extensions of your own client");
  });

  it("lists each plugin it has with its tools and its tab", () => {
    expect(text).toContain("Switched on for you (1):");
    expect(text).toContain("- **Watchlist** — The list of assets the user follows. Tools: WatchlistShow, WatchlistEdit. Tab: Watchlist.");
    expect(text).toContain("OpenView");
  });

  it("names the ones it has not, and why", () => {
    expect(text).toContain("- Alerts: switched off for you — the user can switch it on in Settings → Plugins.");
    expect(text).toContain("- Portfolio: needs an exchange account attached to you");
    expect(text).toContain("- DCA: switched on but could not start (bad config)");
  });

  it("tells a subscription agent about the MCP prefix", () => {
    expect(text).toContain("mcp__bytnode-ai__WatchlistShow");
    expect(pluginsPrompt({ engine: "native", subagent: false, on: [watchlist], absent: [] })).not.toContain("mcp__");
  });

  it("puts each plugin's context under its name, its own headings below", () => {
    expect(text).toContain("### Watchlist\n#### Watchlist\nBTC/USDT, ETH/USDT.");
  });

  it("says so when no plugin is on, and leaves OpenView out without a tab", () => {
    const none = pluginsPrompt({ engine: "native", subagent: false, on: [], absent: [] });
    expect(none).toContain("No plugin is switched on for you");
    expect(none).not.toContain("OpenView");
  });
});

describe("pluginsPrompt: a sub-agent", () => {
  it("lists tools and context only — no tabs, no switches", () => {
    const text = pluginsPrompt({ engine: "native", subagent: true, on: [watchlist], absent: [{ name: "Alerts", about: "x", why: { kind: "off" } }] });
    expect(text).toMatch(/^## BytNode-AI plugins/);
    expect(text).toContain("Tools: WatchlistShow, WatchlistEdit.");
    expect(text).not.toContain("Tab:");
    expect(text).not.toContain("Alerts");
    expect(text).toContain("### Watchlist\n#### Watchlist");
    expect(text).toContain("a plugin's notes below may name others");
  });

  it("is empty when nothing is usable", () => {
    expect(pluginsPrompt({ engine: "native", subagent: true, on: [{ ...watchlist, tools: [], context: [] }], absent: [] })).toBe("");
  });
});

/* --- From the runtime ------------------------------------------------------ */

const tool = (name: string, policy?: Tool["policy"]): Tool => ({ name, description: name, parameters: { type: "object", properties: {} }, ...(policy ? { policy } : {}), execute: async () => ok(name) });

const env = (): RuntimeEnv => ({
  background: false,
  reservedNames: new Set(),
  store: (id) => ({ dir: id }) as unknown as PluginStore,
  notifications: { add: async (plugin, n) => ({ id: "n1", at: 0, plugin, read: false, level: "info", ...n }) },
  confirmations: { request: async () => ({}) as Confirmation },
  session: () => null,
  log: () => {},
});

const def = (id: string, setup: PluginDefinition["setup"], extra: Partial<PluginDefinition["manifest"]> = {}): PluginDefinition => ({
  manifest: { ...manifest(id), name: id.toUpperCase(), forAgents: `About ${id}.`, ...extra },
  setup,
});

describe("pluginPrompt: built from what runs", () => {
  const plugins = [
    def(
      "watch",
      (ctx) => {
        ctx.tool(tool("WatchShow", { readOnly: true, subagent: true }));
        ctx.tool(tool("WatchEdit"));
        ctx.prompt(() => "BTC/USDT.");
      },
      { views: [{ id: "watch", title: "Watch", description: "" }] },
    ),
    def("folio", (ctx) => void ctx.tool(tool("FolioShow", { readOnly: true, subagent: true })), { needs: ["exchange-account"] }),
    def("quiet", (ctx) => void ctx.tool(tool("QuietTool"))),
  ];
  const state: PluginsState = { quiet: { enabled: false, config: {}, agentIds: null } };
  const target = { agentId: "a1", engine: "native" as const, subagent: false };

  it("lists the agent's plugins, and why the others are missing", async () => {
    const rt = new PluginRuntime(plugins, env());
    await rt.apply(state);
    const text = await pluginPrompt(rt, null, target, { "exchange-account": false });
    expect(text).toContain("- **WATCH** — About watch. Tools: WatchShow, WatchEdit. Tab: Watch.");
    expect(text).toContain("- FOLIO: needs an exchange account");
    expect(text).toContain("- QUIET: switched off for you");
    expect(text).toContain("### WATCH\nBTC/USDT.");
  });

  it("a plugin kept from this agent reads as switched off", async () => {
    const rt = new PluginRuntime(plugins, env());
    await rt.apply(state);
    const text = await pluginPrompt(rt, ["folio"], target, { "exchange-account": true });
    expect(text).toContain("- **FOLIO** — About folio. Tools: FolioShow.");
    expect(text).toContain("- WATCH: switched off for you");
  });

  it("a sub-agent sees only the tools it may call", async () => {
    const rt = new PluginRuntime(plugins, env());
    await rt.apply(state);
    const text = await pluginPrompt(rt, null, { ...target, subagent: true }, { "exchange-account": false });
    expect(text).toContain("Tools: WatchShow.");
    expect(text).not.toContain("WatchEdit");
  });
});
