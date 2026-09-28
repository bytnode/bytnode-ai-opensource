import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiRequest } from "../core/contract";
import { harness, type Harness } from "../test-fixture";
import { userPluginDefinition } from "./definition";
import type { ActivePlugin } from "./files";
import { readUserManifest } from "./manifest";

/* The runtime's side of a plugin written by an agent: what it may
   register, and how it comes back after its sandbox was stopped. */

const ID = "u-probe";

function plugin(server: string): ActivePlugin {
  const m = readUserManifest(ID, { name: "Probe", summary: "A probe plugin.", forAgents: "A probe plugin for the tests of the runtime.", permissions: {}, view: null });
  if (!m.ok) throw new Error(m.errors.join(" "));
  return { id: ID, manifest: m.value, grant: { permissions: m.value.permissions, accounts: [], digest: "d", at: "" }, files: { "server.js": server } };
}

const SERVER = `
let calls = 0;
export default {
  setup(ctx) {
    ctx.action("ping", async () => "pong " + (++calls));
    ctx.action("sleep", () => new Promise(() => {}));
    ctx.action("late", async () => {
      try { ctx.action("sneaky", () => "sneaky"); return "registered"; } catch (e) { return e.message; }
    });
    ctx.tool({
      name: "LateMaker",
      description: "Tries to register a tool after setup, which must be refused.",
      readOnly: true,
      run: async () => { try { ctx.tool({ name: "LateTool", description: "A tool registered after the review.", run: () => 1 }); return "registered"; } catch (e) { return e.message; } },
    });
  },
};
`;

let home: string;
const previous = process.env.BYTNODE_AI_HOME;
let h: Harness | null = null;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "bnai-user-def-"));
  process.env.BYTNODE_AI_HOME = home;
});
afterEach(async () => {
  await h?.close();
  h = null;
  if (previous === undefined) delete process.env.BYTNODE_AI_HOME;
  else process.env.BYTNODE_AI_HOME = previous;
  await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const api = (action: string) => h!.runtime.handler(ID, action)!({}, { transport: { bytnodeKey: "", exchangeAccounts: [] }, signal: new AbortController().signal } as unknown as ApiRequest);

describe("a plugin written by an agent, in the runtime", { timeout: 30_000 }, () => {
  it("S11: registers during setup only — a tool or an action registered later is refused", async () => {
    h = await harness([userPluginDefinition(plugin(SERVER))]);
    expect(await api("late")).toMatch(/ctx\.action can only be called during setup/);
    expect(h.runtime.handler(ID, "sneaky")).toBeUndefined();
    const out = await h.tool("LateMaker").execute({}, h.ctx());
    expect(out.output).toMatch(/ctx\.tool can only be called during setup/);
    expect(h.runtime.tools(null).map((t) => t.name)).toEqual(["LateMaker"]);
  });

  it("S10: a call past its timeout stops the sandbox; the next call runs in a fresh one", async () => {
    h = await harness([userPluginDefinition(plugin(SERVER), { limits: { timeoutMs: 200 } })]);
    expect(await api("ping")).toBe("pong 1");
    await expect(api("sleep")).rejects.toThrow(/did not finish within .* stopped/);
    /* A fresh sandbox: the plugin's module state starts again. */
    expect(await api("ping")).toBe("pong 1");
    expect(await api("ping")).toBe("pong 2");
    expect(h.runtime.status().find((s) => s.id === ID)?.state).toBe("active");
  });

  it("S9: a call over its processor budget stops the sandbox; the next call works", async () => {
    const server = `export default { setup(ctx) {
      ctx.action("hog", async () => { for (;;) { const s = Date.now(); while (Date.now() - s < 150) {} await ctx.store.get("x", null); } });
      ctx.action("ping", async () => "pong");
    } };`;
    h = await harness([userPluginDefinition(plugin(server), { limits: { sliceMs: 300, cpuMs: 600 } })]);
    const started = Date.now();
    await expect(api("hog")).rejects.toThrow(/processor time/);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await api("ping")).toBe("pong");
  });
});
