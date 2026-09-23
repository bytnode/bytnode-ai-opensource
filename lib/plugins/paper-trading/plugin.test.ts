import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPaperTool } from "@/lib/tools/names";
import { resolvePolicy } from "@/lib/tools/policy";
import { quote, quotes } from "../shared/prices";
import { definePlugin } from "../core/contract";
import { manifest } from "../core/test-fixture";
import { harness, type Harness } from "../test-fixture";
import type { PaperService } from "./service";
import { paperTradingPlugin } from ".";

vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quote: vi.fn(), quotes: vi.fn() }));

let price = 50_000;
const at = "2026-09-23T10:00:00.000Z";

let h: Harness;
afterEach(async () => h?.close());
beforeEach(() => {
  price = 50_000;
  vi.mocked(quote).mockImplementation(async (symbol) => (symbol === "BTC/USDT" ? { symbol, price, source: "bytnode", at } : { symbol, error: `No price for ${symbol}.` }));
  vi.mocked(quotes).mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, s === "BTC/USDT" ? { symbol: s, price, source: "bytnode", at } : { symbol: s, error: `No price for ${s}.` }])));
});

const ZERO = { "paper-trading": { enabled: true, config: { capital: 1000, feePercent: 0, slippagePercent: 0 }, agentIds: null } };

describe("paper trading plugin", () => {
  it("its tools are simulated, badged PAPER, and kept from sub-agents but the portfolio", async () => {
    h = await harness([paperTradingPlugin]);
    const tools = h.runtime.tools(null);
    expect(tools.map((t) => t.name)).toEqual(["PaperOrder", "PaperCancel", "PaperPortfolio", "PaperReset"]);
    for (const t of tools) expect(isPaperTool(t.name)).toBe(true);
    expect(Object.fromEntries(tools.map((t) => [t.name, resolvePolicy(t.name, t.policy)]))).toMatchObject({
      PaperOrder: { gated: false, subagent: false, alwaysAsk: false },
      PaperCancel: { gated: false, subagent: false },
      PaperPortfolio: { readOnly: true, subagent: true },
      PaperReset: { gated: true, subagent: false },
    });
  });

  it("orders, waits, fills when the market comes, shows the result", async () => {
    h = await harness([paperTradingPlugin], ZERO);
    const buy = await h.tool("PaperOrder").execute({ symbol: "btc", side: "buy", type: "market", quoteAmount: 500 }, h.ctx());
    expect(buy.output).toMatch(/^PAPER order buy 0\.01 BTC\/USDT at market \[\w+\]\. Filled: .* Simulated with paper money/);
    expect(buy.card).toMatchObject({ kind: "facts", data: { badge: "PAPER", title: "Paper order" } });

    const limit = await h.tool("PaperOrder").execute({ symbol: "BTC/USDT", side: "buy", type: "limit", price: 40_000, amount: 0.01 }, h.ctx());
    expect(limit.output).toMatch(/Open, waiting for BTC\/USDT to reach 40000; its funds are held\./);

    price = 39_000;
    const shown = await h.tool("PaperPortfolio").execute({}, h.ctx());
    expect(shown.output).toContain("Equity 880.00 USDT for a capital of 1 000.00 USDT (−120.00 USDT, -12.00 %). Cash 100.00 USDT.");
    expect(shown.output).toContain("- BTC 0.02, average 45000, now 39000 = 780.00 USDT (−120.00 USDT)");
    expect(shown.card).toMatchObject({ kind: "table", data: { badge: "PAPER" } });
    expect(h.notifications).toMatchObject([{ plugin: "paper-trading", title: "Paper order filled", level: "success", action: { kind: "open-view", view: "paper-trading" } }]);
  });

  it("refuses without a price, cancels, resets", async () => {
    h = await harness([paperTradingPlugin], ZERO);
    expect(await h.tool("PaperOrder").execute({ symbol: "ETH/USDT", side: "buy", type: "market", amount: 1 }, h.ctx())).toMatchObject({ ok: false, output: "Paper order refused: No price for ETH/USDT." });
    await h.tool("PaperOrder").execute({ symbol: "BTC/USDT", side: "buy", type: "limit", price: 30_000, amount: 0.01 }, h.ctx());
    expect((await h.tool("PaperCancel").execute({ orderId: "all" }, h.ctx())).output).toMatch(/^PAPER order cancelled: buy 0\.01 BTC\/USDT limit 30000/);
    expect((await h.tool("PaperReset").execute({ capital: 5000 }, h.ctx())).output).toBe("Paper portfolio reset: 5 000.00 USDT of paper cash, nothing else.");
    expect(await h.runtime.prompts(null, { agentId: "a", engine: "native", subagent: false }, {})).toEqual([expect.stringContaining("capital 5 000.00 USDT, cash 5 000.00 USDT, 0 futures position(s), 0 open order(s)")]);
  });

  it("the DCA buys through its service", async () => {
    let service: PaperService | undefined;
    const dca = definePlugin({
      manifest: manifest("dca", ["paper-trading"]),
      setup(ctx) {
        service = ctx.inject<PaperService>("paper-trading");
      },
    });
    h = await harness([paperTradingPlugin, dca], ZERO);
    const r = await service!.buy({ symbol: "BTC/USDT", quoteAmount: 100, note: "DCA: weekly BTC" }, { signal: new AbortController().signal });
    expect(r).toMatchObject({ order: { note: "DCA: weekly BTC", status: "filled" }, fill: { amount: 0.002 } });
  });

  it("the view's look fills the limits the market reached, and says so", async () => {
    h = await harness([paperTradingPlugin], ZERO);
    await h.tool("PaperOrder").execute({ symbol: "BTC/USDT", side: "buy", type: "limit", price: 49_000, amount: 0.01 }, h.ctx());
    price = 48_000;
    const state = (await h.runtime.handler("paper-trading", "state")!({}, { transport: { openrouterKey: "", bytnodeKey: "k", exchangeAccounts: [], plugins: null }, signal: new AbortController().signal })) as { orders: unknown[]; fills: Array<{ price: number }> };
    expect(state.orders).toEqual([]);
    expect(state.fills[0].price).toBe(49_000);
    expect(h.notifications).toHaveLength(1);
  });
});
