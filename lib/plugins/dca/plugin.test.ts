import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exchange } from "ccxt";
import type { AgentConfig } from "@/lib/domain/types";
import type { Confirmation } from "@/lib/domain/plugins";
import { clientFor } from "@/lib/tools/exchange/client";
import { MAIN, fakeExchange } from "@/lib/tools/exchange/test-fixture";
import { definePlugin, type Session } from "../core/contract";
import { pluginStore } from "../core/store";
import { manifest } from "../core/test-fixture";
import { paperTradingPlugin } from "../paper-trading";
import type { JobSpec, SchedulerService } from "../scheduler/service";
import { quote } from "../shared/prices";
import { harness, type Harness } from "../test-fixture";
import type { DcaPlan, Purchase } from "./plans";
import { dcaPlugin } from ".";

vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: vi.fn() }));
vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quote: vi.fn() }));

const jobs = new Map<string, JobSpec>();
const scheduler = definePlugin({
  manifest: manifest("scheduler"),
  setup(ctx) {
    ctx.provide<SchedulerService>((caller) => ({
      job: (spec) => void jobs.set(`${caller.id}:${spec.id}`, spec),
      trigger: async () => {},
      runAgent: async () => ({ ok: false, error: "not in tests" }),
      planned: async () => [],
    }));
  },
});

const SESSION = { bytnodeKey: "k", exchangeAccounts: [MAIN], agents: [] as AgentConfig[] } as unknown as Session;
const STATE = { "paper-trading": { enabled: true, config: { capital: 1000, feePercent: 0, slippagePercent: 0 }, agentIds: null } };
const due = () => jobs.get("dca:due")!.run({ session: SESSION, signal: new AbortController().signal, reason: "schedule" });

let h: Harness;
let exchange: Exchange;
beforeEach(() => {
  jobs.clear();
  vi.mocked(quote).mockImplementation(async (symbol) => ({ symbol, price: 50_000, source: "bytnode", at: "" }));
  exchange = fakeExchange({ fetchBalance: vi.fn(async () => ({ free: { USDT: 1000 }, total: { USDT: 1000 } })), createOrder: vi.fn() });
  vi.mocked(clientFor).mockResolvedValue(exchange);
});
afterEach(async () => h?.close());

const store = () => pluginStore("dca", h.root);
/** Moves every plan's due date into the past (by `ms`). */
const makeDue = (ms: number) => store().update<DcaPlan[]>("plans.json", [], (list) => list.map((p) => ({ ...p, nextDue: new Date(Date.now() - ms).toISOString() })));

describe("DCA plugin", () => {
  it("a paper plan buys by itself, through the paper portfolio", async () => {
    h = await harness([scheduler, paperTradingPlugin, dcaPlugin], STATE);
    const created = await h.tool("DcaCreate").execute({ symbol: "btc", quoteAmount: 100, frequency: "every 7 days", destination: "paper" }, h.ctx());
    expect(created.output).toMatch(/^DCA plan \[\w+\]: 100 USDT of BTC\/USDT, every 7 days, first due .* Simulated purchases in the paper portfolio, automatic\./);
    expect(created.card).toMatchObject({ data: { badge: "PAPER" } });
    expect(await due()).toMatch(/^\w+: filled$/);
    expect(await due()).toBe("Nothing due.");
    const list = await h.tool("DcaList").execute({}, h.ctx());
    expect(list.output).toContain("1 purchase(s): 100 USDT for 0.002 BTC, average 50000");
    expect((await h.tool("PaperPortfolio").execute({}, h.ctx())).output).toContain("- BTC 0.002, average 50000");
    expect(await h.tool("DcaCreate").execute({ symbol: "ETH/BTC", quoteAmount: 1, frequency: "every 7 days", destination: "paper" }, h.ctx())).toMatchObject({ ok: false, output: "The paper portfolio trades against USDT: use ETH/USDT." });
  });

  it("a real plan only PROPOSES: the user's confirmation runs the order, and the fill is recorded", async () => {
    h = await harness([scheduler, paperTradingPlugin, dcaPlugin], STATE);
    const created = await h.tool("DcaCreate").execute({ symbol: "BTC/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "exchange", account: "Binance-main" }, h.ctx({ exchangeAccounts: [MAIN] }));
    expect(created.card).toMatchObject({ data: { badge: "LIVE" } });
    expect(created.output).toMatch(/nothing is bought without it/);

    expect(await due()).toMatch(/: proposed$/);
    expect(exchange.createOrder).not.toHaveBeenCalled();
    expect(h.confirmations).toHaveLength(1);
    const c = h.confirmations[0];
    expect(c).toMatchObject({ plugin: "dca", tool: "PlaceOrder", accountId: "x1", args: { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 100, market: "spot" }, title: "DCA purchase ready: 100 USDT of BTC" });
    expect(c.reason).toMatch(/\(LIVE\).*Nothing is bought until you confirm\./);

    /* A new due date while the last one waits: skipped, not proposed twice. */
    await makeDue(60_000);
    expect(await due()).toMatch(/: skipped$/);
    expect(h.confirmations).toHaveLength(1);

    const confirmation = { id: "c1", at: Date.now(), ...c, status: "allowed", outcome: "Order #9 closed · BUY 0.002 BTC/USDT market · average 50100 · filled 0.002" } as Confirmation;
    await h.runtime.confirmed(confirmation);
    const purchases = await store().read<Purchase[]>("purchases.json", []);
    expect(purchases.map((p) => p.status)).toEqual(["filled", "skipped"]);
    expect(purchases[0]).toMatchObject({ mode: "live", amount: 0.002, price: 50100, confirmationId: "c1" });
    expect((await h.tool("DcaList").execute({}, h.ctx({ exchangeAccounts: [MAIN] }))).output).toContain("average 50100");
  });

  it("checks before proposing; a failure is said, not retried; a missed date is proposed, never bought", async () => {
    h = await harness([scheduler, paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "BTC/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "exchange", account: "Binance-main" }, h.ctx({ exchangeAccounts: [MAIN] }));
    vi.mocked(exchange.fetchBalance).mockResolvedValueOnce({ free: { USDT: 20 } } as never);
    expect(await due()).toMatch(/: failed$/);
    expect(h.notifications).toEqual([expect.objectContaining({ title: "DCA purchase not possible: BTC/USDT", body: expect.stringMatching(/^Not enough USDT on Binance-main: 20 free/), level: "error" })]);
    expect(await due()).toBe("Nothing due.");

    await makeDue(2 * 24 * 3600_000);
    expect(await due()).toMatch(/: proposed$/);
    expect(h.confirmations[0].reason).toMatch(/missed while the app was closed/);
    expect(exchange.createOrder).not.toHaveBeenCalled();
    const [, proposed] = await store().read<Purchase[]>("purchases.json", []);
    expect(proposed).toMatchObject({ status: "proposed", late: true });

    await h.runtime.confirmed({ id: proposed.confirmationId!, at: Date.now(), ...h.confirmations[0], status: "denied", outcome: "Refused by the user." } as Confirmation);
    expect((await store().read<Purchase[]>("purchases.json", []))[1].status).toBe("refused");
  });

  it("pauses, resumes and deletes", async () => {
    h = await harness([scheduler, paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "BTC", quoteAmount: 50, frequency: "daily at 08:00", destination: "paper" }, h.ctx());
    const [plan] = await store().read<DcaPlan[]>("plans.json", []);
    expect((await h.tool("DcaPause").execute({ plan: plan.id }, h.ctx())).output).toMatch(/paused\.$/);
    expect(await due()).toBe("Nothing due.");
    expect((await h.tool("DcaPause").execute({ plan: plan.id, action: "resume" }, h.ctx())).output).toMatch(/resumed, next due/);
    expect((await h.tool("DcaPause").execute({ plan: plan.id, action: "delete" }, h.ctx())).output).toMatch(/deleted\.$/);
    expect((await h.tool("DcaList").execute({}, h.ctx())).output).toBe("No DCA plan.");
  });
});
