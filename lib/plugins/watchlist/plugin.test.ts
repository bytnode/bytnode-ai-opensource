import { afterEach, describe, expect, it, vi } from "vitest";
import { bytnodePairs, quotes } from "../shared/prices";
import { harness, type Harness } from "../test-fixture";
import { watchlistPlugin } from ".";
import type { WatchlistService } from "./service";

vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quotes: vi.fn(), bytnodePairs: vi.fn() }));

let h: Harness;
afterEach(async () => h?.close());

describe("watchlist plugin", () => {
  it("edits the list on disk, announces it, and the prompt names the symbols", async () => {
    h = await harness([watchlistPlugin]);
    const changed = vi.fn();
    h.runtime.bus.on("watchlist:changed", changed);
    const r = await h.tool("WatchlistEdit").execute({ add: ["btc", "ethusdt"], note: "majors" }, h.ctx());
    expect(r.output).toBe("Added: BTC/USDT, ETH/USDT. The watchlist holds 2 assets: BTC/USDT, ETH/USDT.");
    expect(changed).toHaveBeenCalledOnce();
    const prompt = await h.runtime.prompts(null, { agentId: "a", engine: "native", subagent: false });
    expect(prompt[0]).toMatch(/BTC\/USDT, ETH\/USDT/);
  });

  it("shows the prices, and an error for a pair without a source", async () => {
    h = await harness([watchlistPlugin]);
    await h.tool("WatchlistEdit").execute({ add: ["btc", "zzz"] }, h.ctx());
    vi.mocked(quotes).mockResolvedValue(
      new Map([
        ["BTC/USDT", { symbol: "BTC/USDT", price: 64000, change24h: 2.5, change7d: -1, source: "bytnode", at: "2026-09-23T10:00:00.000Z" }],
        ["ZZZ/USDT", { symbol: "ZZZ/USDT", error: "No price for ZZZ/USDT." }],
      ]),
    );
    const r = await h.tool("WatchlistShow").execute({}, h.ctx({ bytnodeKey: "k" }));
    expect(r.output).toContain("BTC/USDT: 64000 · 24 h +2.50 % · 7 d −1.00 % · bytnode 10:00Z");
    expect(r.output).toContain("ZZZ/USDT: — · 24 h — · 7 d — · No price for ZZZ/USDT.");
    expect(r.card?.kind).toBe("table");
  });

  it("offers its symbols as a service to the plugins that require it", async () => {
    let service: WatchlistService | undefined;
    const user = { manifest: { ...watchlistPlugin.manifest, id: "alerts", requires: ["watchlist"], views: [] }, setup: (ctx: import("../core/contract").PluginContext) => void (service = ctx.inject<WatchlistService>("watchlist")) };
    h = await harness([watchlistPlugin, user]);
    await h.tool("WatchlistEdit").execute({ add: ["sol"] }, h.ctx());
    expect(await service!.symbols()).toEqual(["SOL/USDT"]);
  });

  it("the view adds only what BytNode covers — an asset already followed stays editable", async () => {
    h = await harness([watchlistPlugin]);
    vi.mocked(bytnodePairs).mockResolvedValue([
      { symbol: "BTC/USDT", base: "BTC", name: "Bitcoin" },
      { symbol: "ETH/USDT", base: "ETH", name: "Ethereum" },
    ]);
    await h.tool("WatchlistEdit").execute({ add: ["pepe"] }, h.ctx());
    const edit = h.runtime.handler("watchlist", "edit")!;
    const opts = { transport: { openrouterKey: "", bytnodeKey: "k", exchangeAccounts: [], plugins: null }, signal: new AbortController().signal };
    expect(await edit({ add: ["btc", "bbad/usdt", "not a symbol"] }, opts)).toEqual({ count: 2, invalid: ["bbad/usdt", "not a symbol"] });
    expect(await edit({ add: ["PEPE/USDT"], note: "meme" }, opts)).toEqual({ count: 2, invalid: [] });
  });
});
