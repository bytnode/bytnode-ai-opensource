import { afterEach, describe, expect, it } from "vitest";
import { Sandbox, syntaxError, type HostOps } from "./sandbox";

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

  it("points at the line of a syntax error", async () => {
    expect(await syntaxError("export function setup(ctx) {\n  ctx.tool({ name: 'A' \n}", "server.js", "module")).toMatch(/SyntaxError.*server\.js:\d+/);
    expect(await syntaxError("export function setup(ctx) {}", "server.js", "module")).toBeNull();
  });
});
