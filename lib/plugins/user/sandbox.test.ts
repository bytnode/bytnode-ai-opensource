import { afterEach, describe, expect, it } from "vitest";
import { HEAP_OVERHEAD, Sandbox, heapSize, syntaxError, type HostOps } from "./sandbox";

const boxes: Sandbox[] = [];
afterEach(() => {
  for (const b of boxes.splice(0)) b.dispose();
});

function recorder(call: HostOps["call"] = async (op, args) => ({ op, args })) {
  const registered: Array<{ op: string; args: unknown }> = [];
  const ops: HostOps = {
    call,
    register: (op, args) => {
      if (op === "tool" && (args as { name?: string }).name === "Bad") throw new Error("Bad name.");
      registered.push({ op, args });
      return undefined;
    },
  };
  return { ops, registered };
}

async function box(ops: HostOps, limits = {}) {
  const b = await Sandbox.create({ id: "u-test", config: { threshold: 3 }, ops, limits });
  boxes.push(b);
  return b;
}

describe("the sandbox of a plugin written by an agent", () => {
  it("runs setup(ctx) and calls a registered function back, through the host ops", async () => {
    const { ops, registered } = recorder();
    const b = await box(ops);
    await b.setup(`
      export default {
        setup(ctx) {
          ctx.tool({ name: "Echo", description: "d", parameters: { type: "object", properties: {} }, run: async (args) => {
            const r = await ctx.fetch("https://api.example.com/x");
            return { args, r, limit: ctx.config().threshold, id: ctx.id };
          } });
        }
      };
    `);
    const tool = registered.find((r) => r.op === "tool")!.args as { name: string; fn: number };
    expect(tool.name).toBe("Echo");
    const out = await b.invoke(tool.fn, [{ symbol: "BTC" }]);
    expect(out).toEqual({ args: { symbol: "BTC" }, r: { op: "fetch", args: ["https://api.example.com/x", {}] }, limit: 3, id: "u-test" });
  });

  it("accepts `export function setup` too, and refuses a module without one", async () => {
    const { ops, registered } = recorder();
    await (await box(ops)).setup(`export function setup(ctx) { ctx.action("list", () => [1]); }`);
    expect(registered.map((r) => r.op)).toEqual(["action"]);
    await expect((await box(recorder().ops)).setup(`export const x = 1;`)).rejects.toThrow(/must export setup/);
  });

  it("turns a host refusal into a rejection the plugin can catch", async () => {
    const { ops, registered } = recorder(async () => {
      throw new Error("api.evil.com is not in the plugin's permissions.");
    });
    const b = await box(ops);
    await b.setup(`export function setup(ctx) { ctx.action("go", async () => { try { await ctx.fetch("https://api.evil.com"); } catch (e) { return e.message; } }); }`);
    const fn = (registered[0].args as { fn: number }).fn;
    expect(await b.invoke(fn, [])).toBe("api.evil.com is not in the plugin's permissions.");
  });

  it("a registration refused by the host fails the setup with its message", async () => {
    const b = await box(recorder().ops);
    await expect(b.setup(`export function setup(ctx) { ctx.tool({ name: "Bad", description: "d", run: () => 1 }); }`)).rejects.toThrow(/Bad name/);
  });

  it("has no way out: no require, process, fetch, timers", async () => {
    const { ops, registered } = recorder();
    const b = await box(ops);
    await b.setup(`export function setup(ctx) { ctx.action("probe", () => [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof XMLHttpRequest, typeof import.meta].join(",")); }`);
    const fn = (registered[0].args as { fn: number }).fn;
    expect(await b.invoke(fn, [])).toBe("undefined,undefined,undefined,undefined,undefined,object");
  });

  it("stops an endless loop and stays usable", async () => {
    const { ops, registered } = recorder();
    const b = await box(ops, { sliceMs: 200 });
    await b.setup(`export function setup(ctx) { ctx.action("spin", () => { while (true) {} }); ctx.action("ok", () => "fine"); }`);
    const [spin, fine] = registered.map((r) => (r.args as { fn: number }).fn);
    await expect(b.invoke(spin, [])).rejects.toThrow(/ran too long/);
    expect(await b.invoke(fine, [])).toBe("fine");
  });

  it("bounds the memory", { timeout: 30_000 }, async () => {
    const { ops, registered } = recorder();
    const b = await box(ops, { memoryBytes: 4 * 1024 * 1024, sliceMs: 25_000 });
    await b.setup(`export function setup(ctx) { ctx.action("eat", () => { const a = []; for (;;) a.push(new Array(100000).fill(a.length)); }); }`);
    await expect(b.invoke((registered[0].args as { fn: number }).fn, [])).rejects.toThrow(/memory/);
  });

  it("gives up on a call that never settles, after its timeout", async () => {
    const { ops, registered } = recorder(() => new Promise(() => {}));
    const b = await box(ops, { timeoutMs: 150 });
    await b.setup(`export function setup(ctx) { ctx.action("wait", () => ctx.fetch("https://api.example.com")); }`);
    await expect(b.invoke((registered[0].args as { fn: number }).fn, [])).rejects.toThrow(/did not finish within/);
  });

  /* ⚠️ S8 / F8: QuickJS's own limit does not count long strings; the heap
     cap does. The same allocation reached 350 MB before. */
  it("S8: long strings cannot take the heap past its cap, and the plugin hears it at once", { timeout: 30_000 }, async () => {
    const { ops, registered } = recorder();
    const b = await box(ops, { memoryBytes: 16 * 1024 * 1024 });
    await b.setup(`export function setup(ctx) { ctx.action("eat", () => { const held = []; let reached = 0; try { for (let i = 0; i < 400; i++) { held.push("y".repeat(1024 * 1024) + i); reached = i + 1; } return "reached " + reached; } catch (e) { return "stopped at " + reached + ": " + e.message; } }); }`);
    const started = Date.now();
    const out = await b.invoke((registered[0].args as { fn: number }).fn, []);
    expect(out).toMatch(/^stopped at \d+: out of memory/);
    expect(Number(/stopped at (\d+)/.exec(String(out))![1])).toBeLessThan(16 + HEAP_OVERHEAD / 1024 / 1024);
    expect(heapSize(b.module)).toBeLessThanOrEqual(16 * 1024 * 1024 + HEAP_OVERHEAD);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("S8: each sandbox has a heap of its own, capped whatever the others do", async () => {
    const a = await box(recorder().ops);
    const b = await box(recorder().ops);
    expect(a.module).not.toBe(b.module);
  });

  /* S9: a busy loop that awaits a host call now and then used to get a
     fresh slice each time, and hold the server for good. */
  it("S9: the processor time of a call is counted across its awaits", { timeout: 30_000 }, async () => {
    const { ops, registered } = recorder(async () => "ok");
    const b = await box(ops, { sliceMs: 400, cpuMs: 1_000 });
    await b.setup(`export function setup(ctx) { ctx.action("hog", async () => { for (let i = 0; i < 50; i++) { const s = Date.now(); while (Date.now() - s < 300) {} await ctx.fetch("x"); } return "never"; }); }`);
    const started = Date.now();
    await expect(b.invoke((registered[0].args as { fn: number }).fn, [])).rejects.toThrow(/processor time/);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(b.dead).toMatch(/processor time/);
  });

  /* S10 / F7: after the timeout, the plugin kept writing to its store. */
  it("S10: a call past its timeout stops the plugin: none of its host calls lands afterwards", { timeout: 30_000 }, async () => {
    const seen: string[] = [];
    const { ops, registered } = recorder(async (op, args) => {
      seen.push(`${op}:${JSON.stringify(args)}`);
      await new Promise((r) => setTimeout(r, 20));
      return null;
    });
    const b = await box(ops, { timeoutMs: 300 });
    await b.setup(`export function setup(ctx) { ctx.action("spin", async () => { for (let i = 0; ; i++) await ctx.store.set("spin", { i }); }); }`);
    await expect(b.invoke((registered[0].args as { fn: number }).fn, [])).rejects.toThrow(/did not finish within .* stopped/);
    const count = seen.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBeLessThanOrEqual(count + 1);
    expect(b.dead).toMatch(/did not finish/);
    await expect(b.invoke(1, [])).rejects.toThrow(/did not finish/);
  });

  it("points at the line of a syntax error", async () => {
    expect(await syntaxError("export function setup(ctx) {\n  ctx.tool({ name: 'A' \n}", "server.js", "module")).toMatch(/SyntaxError.*server\.js:\d+/);
    expect(await syntaxError("export function setup(ctx) {}", "server.js", "module")).toBeNull();
  });
});
