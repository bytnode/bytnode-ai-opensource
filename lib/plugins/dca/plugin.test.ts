import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exchange } from "ccxt";
import type { AgentConfig } from "@/lib/domain/types";
import type { Confirmation } from "@/lib/domain/plugins";
import { clientFor } from "@/lib/tools/exchange/client";
import { MAIN, fakeExchange } from "@/lib/tools/exchange/test-fixture";
import type { Session } from "../core/contract";
import { pluginStore } from "../core/store";
import { paperTradingPlugin } from "../paper-trading";
import { quote } from "../shared/prices";
import { harness, type Harness } from "../test-fixture";
import type { DcaPlan, Purchase } from "./plans";
import { dcaPlugin } from ".";

vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: vi.fn() }));
vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quote: vi.fn() }));

const SESSION = { bytnodeKey: "k", exchangeAccounts: [MAIN], agents: [] as AgentConfig[] } as unknown as Session;
const STATE = { "paper-trading": { enabled: true, config: { capital: 1000, feePercent: 0, slippagePercent: 0 }, agentIds: null } };
const due = () => h.job("dca:due").run({ session: SESSION, signal: new AbortController().signal, reason: "schedule", cancelled: () => false });

let h: Harness;
let exchange: Exchange;
beforeEach(() => {
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
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
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

  it("a due date is bought once, even when two runs of the job overlap", async () => {
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "ETH/USDT", quoteAmount: 5, frequency: "every 7 days", destination: "paper" }, h.ctx());
    const [plan] = await store().read<DcaPlan[]>("plans.json", []);
    const outcomes = await Promise.all([due(), due()]);
    expect(outcomes.filter((o) => o === "Nothing due.")).toHaveLength(1);
    expect((await store().read<Purchase[]>("purchases.json", [])).map((p) => p.status)).toEqual(["filled"]);
    const [after] = await store().read<DcaPlan[]>("plans.json", []);
    expect(Date.parse(after.nextDue!) - Date.parse(plan.nextDue!)).toBe(7 * 24 * 3600_000);
  });

  it("a real plan only PROPOSES: the user's confirmation runs the order, and the fill is recorded", async () => {
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
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
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
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
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "BTC", quoteAmount: 50, frequency: "daily at 08:00", destination: "paper" }, h.ctx());
    const [plan] = await store().read<DcaPlan[]>("plans.json", []);
    expect((await h.tool("DcaPause").execute({ plan: plan.id }, h.ctx())).output).toMatch(/paused\.$/);
    expect(await due()).toBe("Nothing due.");
    expect((await h.tool("DcaPause").execute({ plan: plan.id, action: "resume" }, h.ctx())).output).toMatch(/resumed, next due/);
    expect((await h.tool("DcaPause").execute({ plan: plan.id, action: "delete" }, h.ctx())).output).toMatch(/deleted\.$/);
    expect((await h.tool("DcaList").execute({}, h.ctx())).output).toBe("No DCA plan.");
  });

  it("A7: one plan that breaks does not cost the others their recorded purchases", async () => {
    vi.mocked(quote).mockImplementation(async (symbol) => {
      if (symbol === "ETH/USDT") throw new Error("Busy: default.json is locked by another process.");
      return { symbol, price: 50_000, source: "bytnode", at: "" };
    });
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "BTC/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "paper" }, h.ctx());
    await h.tool("DcaCreate").execute({ symbol: "ETH/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "paper" }, h.ctx());
    await due();
    const purchases = await store().read<Purchase[]>("purchases.json", []);
    expect(purchases.map((p) => p.status).sort()).toEqual(["failed", "filled"]);
    expect(purchases.find((p) => p.status === "failed")?.detail).toMatch(/Busy/);
    expect(h.notifications.some((n) => /DCA purchase failed: ETH\/USDT/.test(n.title))).toBe(true);
  });

  it("N8: a live proposal confirmed before the run ends is recorded as filled", async () => {
    h = await harness([paperTradingPlugin, dcaPlugin], {});
    await h.tool("DcaCreate").execute({ symbol: "BTC/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "exchange" }, h.ctx({ exchangeAccounts: [MAIN] }));
    await h.tool("DcaCreate").execute({ symbol: "ETH/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "exchange" }, h.ctx({ exchangeAccounts: [MAIN] }));
    /* The second plan's exchange check is where the user's click lands. */
    let reads = 0;
    const original = exchange.fetchBalance;
    exchange.fetchBalance = vi.fn(async (...args: unknown[]) => {
      reads++;
      if (reads === 2) {
        const c = h.confirmations[0];
        await h.runtime.confirmed({ id: "c1", at: Date.now(), ...c, status: "allowed", outcome: "Order #o1 closed · BUY 0.002 BTC/USDT market · average 50000 · filled 0.002" } as Confirmation);
      }
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as Exchange["fetchBalance"];
    await due();
    const purchases = await store().read<Purchase[]>("purchases.json", []);
    expect(purchases).toHaveLength(2);
    expect(purchases.find((p) => p.confirmationId === "c1")).toMatchObject({ status: "filled", amount: 0.002, price: 50_000 });
    expect(purchases.find((p) => p.confirmationId === "c2")).toMatchObject({ status: "proposed" });
  });

  it("runs without the paper trading: real plans go on, a paper plan is refused, a due one says why", async () => {
    h = await harness([paperTradingPlugin, dcaPlugin], STATE);
    await h.tool("DcaCreate").execute({ symbol: "BTC/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "paper" }, h.ctx());
    await h.runtime.apply({ ...STATE, "paper-trading": { ...STATE["paper-trading"], enabled: false } });
    expect(h.runtime.isRunning("dca")).toBe(true);
    expect((await h.tool("DcaCreate").execute({ symbol: "ETH/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "paper" }, h.ctx())).output).toMatch(/Paper trading is off/);
    expect(await due()).toMatch(/: failed$/);
    expect((await store().read<Purchase[]>("purchases.json", []))[0]).toMatchObject({ status: "failed", detail: expect.stringMatching(/Paper trading is off/) });
    expect((await h.tool("DcaCreate").execute({ symbol: "ETH/USDT", quoteAmount: 100, frequency: "every 7 days", destination: "exchange" }, h.ctx({ exchangeAccounts: [MAIN] }))).ok).toBe(true);
  });
});
