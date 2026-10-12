import { describe, expect, it, vi } from "vitest";
import type { Confirmation, PluginsState } from "@/lib/domain/plugins";
import type { Tool } from "@/lib/tools/types";
import { ok } from "@/lib/tools/types";
import type { PluginContext, PluginDefinition } from "./contract";
import { PROMPT_LIMIT, PluginRuntime, type RuntimeEnv } from "./runtime";
import type { PluginStore } from "./store";
import { manifest } from "./test-fixture";
import { readingForAgent } from "@/lib/bytnode/reader";

const tool = (name: string, policy?: Tool["policy"]): Tool => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
  ...(policy ? { policy } : {}),
  execute: async () => ok(name),
});

function env(over: Partial<RuntimeEnv> = {}): RuntimeEnv & { logs: string[]; cleared: string[] } {
  const logs: string[] = [];
  const cleared: string[] = [];
  return {
    logs,
    cleared,
    background: true,
    reservedNames: new Set(["Read", "PlaceOrder"]),
    store: (id) => ({ dir: id, clear: async () => void cleared.push(id) }) as unknown as PluginStore,
    notifications: { add: async (plugin, n) => ({ id: "n1", at: 0, plugin, read: false, level: "info", ...n }) },
    confirmations: { request: async () => ({}) as Confirmation },
    session: () => null,
    log: (m) => void logs.push(m),
    ...over,
  };
}

const plugin = (id: string, setup: PluginDefinition["setup"], requires: string[] = [], optional: string[] = []): PluginDefinition => ({ manifest: manifest(id, requires, optional), setup });

const off = (...ids: string[]): PluginsState => Object.fromEntries(ids.map((id) => [id, { enabled: false, config: {}, agentIds: null }]));

describe("PluginRuntime: starting", () => {
  it("runs a plugin's tool as an AI agent's reading (BytNode through MCP), its actions as the app's", async () => {
    const seen: Record<string, boolean> = {};
    const rt = new PluginRuntime(
      [
        plugin("watchlist", (ctx) => {
          ctx.tool({ ...tool("WatchlistShow"), execute: async () => ok(String((seen.tool = readingForAgent()))) });
          ctx.api("list", async () => (seen.action = readingForAgent()));
        }),
      ],
      env(),
    );
    await rt.apply({});
    await rt.tools(null)[0].execute({}, {} as never);
    expect(seen.tool).toBe(true);
    expect(readingForAgent()).toBe(false);
  });

  it("starts in dependency order and collects the tools", async () => {
    const order: string[] = [];
    const rt = new PluginRuntime(
      [
        plugin("alerts", (ctx) => void (order.push("alerts"), ctx.tool(tool("AlertList"))), ["scheduler"]),
        plugin("scheduler", (ctx) => void (order.push("scheduler"), ctx.tool(tool("TaskList")))),
      ],
      env(),
    );
    await rt.apply({});
    expect(order).toEqual(["scheduler", "alerts"]);
    expect(rt.tools(null).map((t) => t.name)).toEqual(["TaskList", "AlertList"]);
    expect(rt.tools(["alerts"]).map((t) => t.name)).toEqual(["AlertList"]);
    expect(rt.status()).toEqual([
      { id: "scheduler", state: "active" },
      { id: "alerts", state: "active" },
    ]);
  });

  it("a plugin whose needs the agent does not meet gives it nothing", async () => {
    const def = plugin("portfolio", (ctx) => ctx.tool(tool("PortfolioSummary")));
    def.manifest.needs = ["exchange-account"];
    const rt = new PluginRuntime([def], env());
    await rt.apply({});
    expect(rt.tools(null, { "exchange-account": false })).toEqual([]);
    expect(rt.tools(null, { "exchange-account": true })).toHaveLength(1);
  });

  it("a failing setup marks it in error, blocks its dependents, spares the rest", async () => {
    const e = env();
    const rt = new PluginRuntime(
      [
        plugin("scheduler", () => {
          throw new Error("disk full");
        }),
        plugin("alerts", (ctx) => ctx.tool(tool("AlertList")), ["scheduler"]),
        plugin("watchlist", (ctx) => ctx.tool(tool("WatchlistShow"))),
      ],
      e,
    );
    await rt.apply({});
    expect(rt.status()).toEqual([
      { id: "scheduler", state: "error", message: "disk full" },
      { id: "alerts", state: "blocked", message: "Requires scheduler, which is not running." },
      { id: "watchlist", state: "active" },
    ]);
    expect(rt.tools(null).map((t) => t.name)).toEqual(["WatchlistShow"]);
    expect(e.logs.some((l) => l.includes("scheduler failed to start: disk full"))).toBe(true);
  });

  it("undoes what a failing setup had registered", async () => {
    const undone = vi.fn();
    const rt = new PluginRuntime(
      [
        plugin("x", (ctx) => {
          ctx.onDispose(undone);
          ctx.tool(tool("XTool"));
          throw new Error("late failure");
        }),
      ],
      env(),
    );
    await rt.apply({});
    expect(undone).toHaveBeenCalledOnce();
    expect(rt.tools(null)).toEqual([]);
  });

  it("a hanging setup times out", async () => {
    const rt = new PluginRuntime([plugin("slow", () => new Promise(() => {}))], env({ setupTimeoutMs: 20 }));
    await rt.apply({});
    expect(rt.status()[0]).toEqual({ id: "slow", state: "error", message: "slow: setup took too long." });
  });

  it("does not retry a failure until something changes for it", async () => {
    let calls = 0;
    const rt = new PluginRuntime(
      [
        plugin("flaky", () => {
          calls++;
          if (calls === 1) throw new Error("first time");
        }),
      ],
      env(),
    );
    await rt.apply({});
    await rt.apply({});
    expect(calls).toBe(1);
    await rt.apply({ flaky: { enabled: true, config: {}, agentIds: ["a1"] } });
    expect(calls).toBe(2);
    expect(rt.isRunning("flaky")).toBe(true);
  });

  it("refuses a core tool's name and a name already taken", async () => {
    const rt = new PluginRuntime(
      [plugin("a", (ctx) => ctx.tool(tool("Shared"))), plugin("b", (ctx) => ctx.tool(tool("Shared"))), plugin("c", (ctx) => ctx.tool(tool("PlaceOrder")))],
      env(),
    );
    await rt.apply({});
    expect(rt.status()).toEqual([
      { id: "a", state: "active" },
      { id: "b", state: "error", message: "The tool name Shared is already taken by a." },
      { id: "c", state: "error", message: "The tool name PlaceOrder belongs to the core." },
    ]);
  });
});

describe("PluginRuntime: stopping and changing", () => {
  it("disabling a plugin disposes everything it installed, and its dependents", async () => {
    const disposed: string[] = [];
    const rt = new PluginRuntime(
      [
        plugin("scheduler", (ctx) => {
          ctx.tool(tool("TaskList"));
          ctx.onDispose(() => void disposed.push("scheduler timer"));
        }),
        plugin("alerts", (ctx) => ctx.onDispose(() => void disposed.push("alerts job")), ["scheduler"]),
      ],
      env(),
    );
    await rt.apply({});
    await rt.apply(off("scheduler"));
    expect(disposed).toEqual(["alerts job", "scheduler timer"]);
    expect(rt.tools(null)).toEqual([]);
    expect(rt.status().map((s) => s.state)).toEqual(["disabled", "disabled"]);
  });

  it("a configuration change restarts the plugin and whatever uses it", async () => {
    const starts: string[] = [];
    const defs = [
      plugin("portfolio", (ctx) => void starts.push(`portfolio ${ctx.config().currency}`)),
      plugin("report", () => void starts.push("report"), [], ["portfolio"]),
      plugin("watchlist", () => void starts.push("watchlist")),
    ];
    defs[0].manifest.config.properties.currency = { type: "string", title: "Currency", default: "USD", enum: ["USD", "EUR"] };
    const rt = new PluginRuntime(defs, env());
    await rt.apply({});
    await rt.apply({ portfolio: { enabled: true, config: { currency: "EUR" }, agentIds: null } });
    await rt.apply({ portfolio: { enabled: true, config: { currency: "EUR" }, agentIds: ["a1"] } });
    expect(starts).toEqual(["portfolio USD", "report", "watchlist", "portfolio EUR", "report"]);
  });

  it("clearing a plugin's data stops it, deletes, starts it again", async () => {
    const e = env();
    let starts = 0;
    const rt = new PluginRuntime([plugin("watchlist", () => void starts++)], e);
    await rt.apply({});
    await rt.clearData("watchlist");
    expect(e.cleared).toEqual(["watchlist"]);
    expect(starts).toBe(2);
    expect(rt.isRunning("watchlist")).toBe(true);
  });

  it("a runtime shut down stays down: a late apply starts nothing again", async () => {
    let starts = 0;
    const rt = new PluginRuntime([plugin("scheduler", () => void starts++)], env());
    await rt.apply({});
    const shutdown = rt.shutdown();
    /* A request that picked this runtime before it was replaced. */
    await rt.apply({});
    await shutdown;
    expect(starts).toBe(1);
    expect(rt.isRunning("scheduler")).toBe(false);
  });
});

describe("PluginRuntime: services, events, prompts", () => {
  it("a service is reached through a declared optional dependency, bound to its caller", async () => {
    const jobs: string[] = [];
    let seen: string | undefined;
    const rt = new PluginRuntime(
      [
        plugin("scheduler", (ctx) => ctx.provide((caller: PluginContext) => ({ job: (name: string) => void jobs.push(`${caller.id}:${name}`) }))),
        plugin("alerts", (ctx) => ctx.optional<{ job: (n: string) => void }>("scheduler")?.job("evaluate"), [], ["scheduler"]),
        plugin("sneaky", (ctx) => {
          try {
            ctx.optional("scheduler");
          } catch (e) {
            seen = (e as Error).message;
          }
        }),
      ],
      env(),
    );
    await rt.apply({});
    expect(jobs).toEqual(["alerts:evaluate"]);
    expect(seen).toBe("sneaky did not declare scheduler in `optional`.");
  });

  it("jobs go on the runtime's own clock, keyed by their plugin, and go when it stops", async () => {
    const rt = new PluginRuntime([plugin("alerts", (ctx) => ctx.job({ id: "check", title: "Alerts", every: "every 1 minute", run: async () => "ok" }))], env({ background: false }));
    await rt.apply({});
    expect(rt.clock.list().map((j) => j.id)).toEqual(["alerts:check"]);
    await rt.apply(off("alerts"));
    expect(rt.clock.list()).toEqual([]);
  });

  it("switching any plugin off leaves every other one running (no plugin needs another)", async () => {
    const ids = ["scheduler", "watchlist", "calendar", "alerts", "paper-trading", "dca"];
    const rt = new PluginRuntime(
      [
        plugin("scheduler", (ctx) => ctx.provide(() => ({ planned: async () => [] }))),
        plugin("watchlist", (ctx) => ctx.provide(() => ({ symbols: async () => [] }))),
        plugin("calendar", (ctx) => void ctx.optional("scheduler"), [], ["watchlist", "scheduler"]),
        plugin("alerts", (ctx) => ctx.job({ id: "check", title: "Alerts", every: "every 1 minute", run: async () => "ok" }), [], ["watchlist", "calendar"]),
        plugin("paper-trading", (ctx) => ctx.provide(() => ({ cash: "USDT" }))),
        plugin("dca", (ctx) => ctx.job({ id: "due", title: "DCA", every: "every 1 minute", run: async () => "ok" }), [], ["paper-trading"]),
      ],
      env({ background: false }),
    );
    for (const id of ids) {
      await rt.apply(off(id));
      for (const other of ids.filter((x) => x !== id)) expect(rt.isRunning(other), `${other} with ${id} off`).toBe(true);
      expect(rt.isRunning(id)).toBe(false);
    }
    await rt.apply({});
    expect(rt.status().every((s) => s.state === "active")).toBe(true);
  });

  it("an optional service appears and disappears with its provider", async () => {
    const seen: Array<string | undefined> = [];
    const rt = new PluginRuntime(
      [plugin("scheduler", (ctx) => ctx.provide(() => "clock")), plugin("portfolio", (ctx) => void seen.push(ctx.optional<string>("scheduler")), [], ["scheduler"])],
      env(),
    );
    await rt.apply(off("scheduler"));
    await rt.apply({});
    await rt.apply(off("scheduler"));
    expect(seen).toEqual([undefined, "clock", undefined]);
  });

  it("events are namespaced by their emitter and stop with the listener", async () => {
    const got: unknown[] = [];
    let emit: (p: unknown) => void = () => {};
    const rt = new PluginRuntime(
      [plugin("watchlist", (ctx) => void (emit = (p) => ctx.emit("changed", p))), plugin("alerts", (ctx) => ctx.on("watchlist:changed", (p) => void got.push(p)))],
      env(),
    );
    await rt.apply({});
    emit({ n: 1 });
    await rt.apply(off("alerts"));
    emit({ n: 2 });
    expect(got).toEqual([{ n: 1 }]);
  });

  it("prompt sections are bounded; a failing one is left out", async () => {
    const e = env();
    const rt = new PluginRuntime(
      [
        plugin("big", (ctx) => ctx.prompt(() => "x".repeat(PROMPT_LIMIT + 50))),
        plugin("broken", (ctx) =>
          ctx.prompt(() => {
            throw new Error("no file");
          }),
        ),
        plugin("small", (ctx) => ctx.prompt((t) => `for ${t.agentId}`)),
      ],
      e,
    );
    await rt.apply({});
    const out = await rt.prompts(null, { agentId: "a1", engine: "native", subagent: false });
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(PROMPT_LIMIT);
    expect(out[0].endsWith("…")).toBe(true);
    expect(out[1]).toBe("for a1");
    expect(e.logs.some((l) => l.includes("broken: prompt section failed"))).toBe(true);
  });

  it("routes a decided confirmation to its plugin, and lists the tools that always ask", async () => {
    const decided: string[] = [];
    const rt = new PluginRuntime(
      [
        plugin("dca", (ctx) => {
          ctx.onConfirmed((c) => void decided.push(`${c.id}:${c.status}`));
          ctx.tool(tool("DcaList", { readOnly: true }));
          ctx.tool(tool("Payout", { alwaysAsk: true }));
        }),
      ],
      env(),
    );
    await rt.apply({});
    await rt.confirmed({ id: "c1", plugin: "dca", status: "allowed" } as Confirmation);
    await rt.confirmed({ id: "c2", plugin: "ghost", status: "denied" } as Confirmation);
    expect(decided).toEqual(["c1:allowed"]);
    expect(rt.alwaysAskTools()).toEqual(["Payout"]);
  });
});

describe("PluginRuntime: plugins added and removed while it runs", () => {
  it("a new one starts, a changed one restarts with its users, a removed one stops — the others are left alone", async () => {
    const events: string[] = [];
    const track = (id: string): PluginDefinition["setup"] => (ctx) => {
      events.push(`start ${id}`);
      ctx.onDispose(() => void events.push(`stop ${id}`));
    };
    const scheduler = plugin("scheduler", track("scheduler"));
    const watchlist = plugin("watchlist", track("watchlist"));
    const rt = new PluginRuntime([scheduler, watchlist], env());
    await rt.apply({});
    events.length = 0;

    const mine = plugin("u-dividends", track("u-dividends"), [], ["scheduler"]);
    await rt.replaceDefinitions([scheduler, watchlist, mine]);
    expect(events).toEqual(["start u-dividends"]);
    expect(rt.isRunning("u-dividends")).toBe(true);

    events.length = 0;
    const changed = plugin("u-dividends", track("u-dividends v2"), [], ["scheduler"]);
    await rt.replaceDefinitions([scheduler, watchlist, changed]);
    expect(events).toEqual(["stop u-dividends", "start u-dividends v2"]);

    events.length = 0;
    await rt.replaceDefinitions([scheduler, watchlist]);
    expect(events).toEqual(["stop u-dividends v2"]);
    expect(rt.status().map((s) => s.id)).toEqual(["scheduler", "watchlist"]);
  });

  it("before the first apply, swapping the definitions starts nothing", async () => {
    const started: string[] = [];
    const rt = new PluginRuntime([], env());
    await rt.replaceDefinitions([plugin("u-x", () => void started.push("u-x"))]);
    expect(started).toEqual([]);
    await rt.apply(off());
    expect(started).toEqual(["u-x"]);
  });

  it("a plugin that failed gets a fresh attempt when its definition changes", async () => {
    const rt = new PluginRuntime([plugin("u-x", () => Promise.reject(new Error("boom")))], env());
    await rt.apply({});
    expect(rt.status()[0].state).toBe("error");
    await rt.replaceDefinitions([plugin("u-x", () => {})]);
    expect(rt.status()[0].state).toBe("active");
  });
});
