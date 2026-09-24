import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import type { CalendarService } from "../calendar/service";
import { definePlugin, type Session } from "../core/contract";
import { manifest } from "../core/test-fixture";
import type { JobSpec, SchedulerService } from "../scheduler/service";
import { quotes } from "../shared/prices";
import { harness, type Harness } from "../test-fixture";
import { watchlistPlugin } from "../watchlist";
import { alertsPlugin } from ".";

vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quotes: vi.fn(), fundingRate: vi.fn(async () => undefined) }));

const jobs = new Map<string, JobSpec>();
const triggered: string[] = [];
const scheduler = definePlugin({
  manifest: manifest("scheduler"),
  setup(ctx) {
    ctx.provide<SchedulerService>((caller) => ({
      job: (spec) => void jobs.set(`${caller.id}:${spec.id}`, spec),
      trigger: async (id) => void triggered.push(`${caller.id}:${id}`),
      runAgent: async () => ({ ok: false, error: "not in tests" }),
      planned: async () => [],
    }));
  },
});
const calendar = definePlugin({
  manifest: manifest("calendar"),
  setup(ctx) {
    ctx.provide<CalendarService>(() => ({
      upcoming: async ({ assets }) => (assets?.includes("BTC") ? [{ id: "e", startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), allDay: false, category: "macro", title: "FOMC", assets: [], importance: 3, source: "Fed", url: "https://fed.gov", fetchedAt: "" }] : []),
    }));
  },
});

const prices: Record<string, { price: number; change24h?: number }> = {};
const SESSION = { bytnodeKey: "k", exchangeAccounts: [], agents: [] as AgentConfig[] } as unknown as Session;
const check = () => jobs.get("alerts:check")!.run({ session: SESSION, signal: new AbortController().signal, reason: "schedule" });

let h: Harness;
beforeEach(() => {
  jobs.clear();
  triggered.length = 0;
  for (const k of Object.keys(prices)) delete prices[k];
  vi.mocked(quotes).mockImplementation(async (symbols) => new Map(symbols.map((s) => [s, prices[s] ? { symbol: s, ...prices[s], source: "bytnode", at: "" } : { symbol: s, error: `No price for ${s}.` }])));
});
afterEach(async () => h?.close());

describe("alerts plugin", () => {
  it("fires once per crossing, into the notification center", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    const made = await h.tool("AlertCreate").execute({ symbol: "btc", condition: "price >= 70000", once: false, note: "take profit" }, h.ctx());
    expect(made.output).toMatch(/^Alert \[\w+\] set: BTC\/USDT, price>=70000, at every crossing\./);
    expect(triggered).toEqual(["alerts:check"]);

    prices["BTC/USDT"] = { price: 69_000 };
    expect(await check()).toBe("1 alert(s) checked, 0 fired.");
    prices["BTC/USDT"] = { price: 70_500 };
    expect(await check()).toBe("1 alert(s) checked, 1 fired.");
    expect(await check()).toBe("1 alert(s) checked, 0 fired.");
    expect(h.notifications).toEqual([{ plugin: "alerts", title: "Alert: BTC/USDT price>=70000", body: "price 70500 — take profit", level: "warning", action: { kind: "open-view", view: "alerts" } }]);
    expect((await h.tool("AlertList").execute({}, h.ctx())).output).toMatch(/Last fired:\n- .* — BTC\/USDT price>=70000: price 70500/);
  });

  it("watches the whole watchlist, and says when an asset has no price", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    await h.tool("WatchlistEdit").execute({ add: ["BTC", "ETH", "XYZ"] }, h.ctx());
    await h.tool("AlertCreate").execute({ symbol: "watchlist", condition: "change24h>5%" }, h.ctx());
    prices["BTC/USDT"] = { price: 1, change24h: 1 };
    prices["ETH/USDT"] = { price: 1, change24h: 7.5 };
    expect(await check()).toBe("1 alert(s) checked, 1 fired, 1 cannot be checked.");
    expect(h.notifications.map((n) => n.title)).toEqual(["Alert: ETH/USDT change24h>5%", "Alert cannot be checked: XYZ/USDT change24h>5%"]);
    expect(h.notifications[1].body).toBe("No price for XYZ/USDT.");
    /* One-shot: done after ETH fired. */
    expect(await check()).toBe("No active alert.");
    expect((await h.tool("AlertList").execute({}, h.ctx())).output).toMatch(/Done \(fired once\):\n- \[\w+\] every watchlist asset: change24h>5% — once, done; fired ETH\/USDT .*; CANNOT EVALUATE: XYZ\/USDT: No price for XYZ\/USDT\./);
  });

  it("event alerts need the calendar; position alerts need an account", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    expect(await h.tool("AlertCreate").execute({ symbol: "BTC", condition: "event<6h" }, h.ctx())).toMatchObject({ ok: false, output: expect.stringMatching(/need the market calendar/) });
    expect((await h.tool("AlertCreate").execute({ symbol: "BTC", condition: "liq<3%" }, h.ctx())).ok).toBe(false);
    await h.close();

    h = await harness([scheduler, watchlistPlugin, calendar, alertsPlugin]);
    await h.tool("AlertCreate").execute({ symbol: "BTC", condition: "event<6h" }, h.ctx());
    prices["BTC/USDT"] = { price: 1 };
    expect(await check()).toBe("1 alert(s) checked, 1 fired.");
    expect(h.notifications[0]).toMatchObject({ title: "Alert: BTC/USDT event<6h", body: "FOMC in 3 h" });
  });

  it("deletes one alert or all", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    await h.tool("AlertCreate").execute({ symbol: "BTC", condition: "price<1" }, h.ctx());
    await h.tool("AlertCreate").execute({ symbol: "ETH", condition: "price<1" }, h.ctx());
    expect((await h.tool("AlertDelete").execute({ id: "all" }, h.ctx())).output).toMatch(/^Deleted: \[\w+\] BTC\/USDT price<1; \[\w+\] ETH\/USDT price<1\.$/);
    expect((await h.tool("AlertDelete").execute({ id: "nope" }, h.ctx())).ok).toBe(false);
  });
});
