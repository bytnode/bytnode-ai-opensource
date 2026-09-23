import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientFor } from "@/lib/tools/exchange/client";
import { MAIN, TESTNET, fakeExchange } from "@/lib/tools/exchange/test-fixture";
import { quotes } from "../shared/prices";
import { harness, type Harness } from "../test-fixture";
import { portfolioPlugin } from ".";

vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: vi.fn() }));
vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quotes: vi.fn() }));
vi.mock("../shared/rates", () => ({ usdRates: vi.fn(async () => ({ value: { USD: 1, EUR: 0.8 }, at: "2026-09-23T10:00:00.000Z", source: "Kraken" })) }));

let h: Harness;
afterEach(async () => h?.close());

beforeEach(() => {
  vi.mocked(clientFor).mockImplementation(async (account, market) => {
    const live = !account.testnet;
    if (market === "spot") {
      return fakeExchange({
        id: account.exchange,
        fetchBalance: vi.fn(async (params?: { type?: string }) => (params?.type === "funding" ? { total: live ? { USDC: 40 } : {} } : { total: live ? { BTC: 0.1, USDT: 1000 } : { USDT: 10000 } })),
      });
    }
    return fakeExchange({
      id: account.exchange,
      fetchBalance: vi.fn(async () => ({ total: live ? { USDT: 500 } : {} })),
      fetchPositions: vi.fn(async () => (live ? [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.01, contractSize: 1, entryPrice: 60000, markPrice: 64000, unrealizedPnl: 40, leverage: 5, liquidationPrice: 49000 }] : [])),
    });
  });
  vi.mocked(quotes).mockResolvedValue(new Map([["BTC/USDT", { symbol: "BTC/USDT", price: 64000, source: "bytnode", at: "2026-09-23T10:00:00.000Z" }]]));
});

describe("portfolio plugin", () => {
  it("consolidates the live accounts, testnet apart (Bybit unified: futures read once)", async () => {
    h = await harness([portfolioPlugin]);
    const r = await h.tool("PortfolioSummary").execute({}, h.ctx({ exchangeAccounts: [MAIN, TESTNET] }));
    /* Binance: 6 400 + 1 000 + 40 funding + 500 futures. */
    expect(r.output).toContain("Total, live accounts: 7 940.00 USD.");
    expect(r.output).toContain("Testnet accounts, not counted: 10 000.00 USD.");
    expect(r.output).toContain("BTC/USDT:USDT long 0.01 @ 60000, mark 64000, PnL 40 ×5, liquidation 49000");
    expect(r.card).toMatchObject({ kind: "facts", data: { title: "Portfolio" } });
  });

  it("shows the reference currency, with its rate and source", async () => {
    h = await harness([portfolioPlugin], { portfolio: { enabled: true, config: { currency: "EUR" }, agentIds: null } });
    const r = await h.tool("PortfolioSummary").execute({}, h.ctx({ exchangeAccounts: [MAIN] }));
    expect(r.output).toContain("in EUR (1 USD = 0.800000 EUR, Kraken 10:00 UTC)");
    expect(r.output).toContain("Total, live accounts: 6 352.00 EUR.");
  });

  it("flags an unreadable account without dropping the others", async () => {
    vi.mocked(clientFor).mockRejectedValueOnce(Object.assign(new Error("Invalid API-key"), { name: "AuthenticationError" }));
    h = await harness([portfolioPlugin]);
    const r = await h.tool("PortfolioSummary").execute({}, h.ctx({ exchangeAccounts: [MAIN] }));
    expect(r.output).toMatch(/could not read: spot: /);
    expect(r.output).toContain("Total, live accounts: 500.00 USD.");
  });

  it("history: says when there is nothing yet", async () => {
    h = await harness([portfolioPlugin]);
    expect((await h.tool("PortfolioHistory").execute({ days: 30 }, h.ctx())).output).toMatch(/No snapshot in the last 30 days/);
  });
});
