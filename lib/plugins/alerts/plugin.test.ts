import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/lib/domain/types";
import type { CalendarService } from "../calendar/service";
import { definePlugin, type Session } from "../core/contract";
import { manifest } from "../core/test-fixture";
import type { JobSpec, SchedulerService } from "../scheduler/service";
import { candles, quotes } from "../shared/prices";
import type { ApiRequest } from "../core/contract";
import { harness, type Harness } from "../test-fixture";
import { watchlistPlugin } from "../watchlist";
import { alertsPlugin } from ".";

vi.mock("../shared/prices", async (orig) => ({ ...(await orig<typeof import("../shared/prices")>()), quotes: vi.fn(), candles: vi.fn(), fundingRate: vi.fn(async () => undefined) }));

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
    expect(made.output).toMatch(/^Alert \[\w+\] set: BTC\/USDT, price>=70000 \(Price ≥ 70000\), at every crossing\./);
    expect(triggered).toEqual(["alerts:check"]);

    prices["BTC/USDT"] = { price: 69_000 };
    expect(await check()).toBe("1 alert(s) checked, 0 fired.");
    prices["BTC/USDT"] = { price: 70_500 };
    expect(await check()).toBe("1 alert(s) checked, 1 fired.");
    expect(await check()).toBe("1 alert(s) checked, 0 fired.");
    expect(h.notifications).toEqual([{ plugin: "alerts", title: "BTC/USDT: Price ≥ 70000", body: "price 70500 — take profit", level: "warning", action: { kind: "open-view", view: "alerts" } }]);
    expect((await h.tool("AlertList").execute({}, h.ctx())).output).toMatch(/Last fired:\n- .* — BTC\/USDT price>=70000: price 70500/);
  });

  it("watches the whole watchlist, and says when an asset has no price", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    await h.tool("WatchlistEdit").execute({ add: ["BTC", "ETH", "XYZ"] }, h.ctx());
    await h.tool("AlertCreate").execute({ symbol: "watchlist", condition: "change24h>5%" }, h.ctx());
    prices["BTC/USDT"] = { price: 1, change24h: 1 };
    prices["ETH/USDT"] = { price: 1, change24h: 7.5 };
    expect(await check()).toBe("1 alert(s) checked, 1 fired, 1 cannot be checked.");
    expect(h.notifications.map((n) => n.title)).toEqual(["ETH/USDT: 24h change > +5 %", "Alert cannot be checked: XYZ/USDT, 24h change > +5 %"]);
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
    expect(h.notifications[0]).toMatchObject({ title: "BTC/USDT: A notable event within 6 h", body: "FOMC in 3 h" });
  });

  it("deletes one alert or all", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    await h.tool("AlertCreate").execute({ symbol: "BTC", condition: "price<1" }, h.ctx());
    await h.tool("AlertCreate").execute({ symbol: "ETH", condition: "price<1" }, h.ctx());
    expect((await h.tool("AlertDelete").execute({ id: "all" }, h.ctx())).output).toMatch(/^Deleted: \[\w+\] BTC\/USDT price<1; \[\w+\] ETH\/USDT price<1\.$/);
    expect((await h.tool("AlertDelete").execute({ id: "nope" }, h.ctx())).ok).toBe(false);
  });

  it("an indicator alert reads the candles once per pair and timeframe, and can be paused", async () => {
    h = await harness([scheduler, watchlistPlugin, alertsPlugin]);
    const api = (action: string, params: Record<string, unknown>) => h.runtime.handler("alerts", action)!(params, { transport: { bytnodeKey: "k", exchangeAccounts: [] }, signal: new AbortController().signal } as unknown as ApiRequest);
    /* Falling closes: the RSI sits at 0 until the last bar jumps. */
    let closes = Array.from({ length: 200 }, (_, i) => 200 - i * 0.5);
    vi.mocked(candles).mockImplementation(async (symbol, interval) => ({ symbol, interval, source: "bytnode", candles: closes.map((c, i) => ({ t: Date.now() - (closes.length - i) * 3_600_000, o: c, h: c, l: c, c, v: 1 })) }));
    prices["ETH/USDT"] = { price: 100.5 };

    const made = await h.tool("AlertCreate").execute({ symbol: "eth", condition: "rsi(14,1h) crosses_above 50", once: false }, h.ctx());
    expect(made.output).toMatch(/rsi\(14,1h\) crosses_above 50 \(RSI 14 · 1H crosses above 50\)/);
    await h.tool("AlertCreate").execute({ symbol: "eth", condition: "price<sma(20,1h)" }, h.ctx());
    expect(await check()).toBe("2 alert(s) checked, 1 fired.");
    /* Both indicators on the hour: one candles read. */
    expect(vi.mocked(candles)).toHaveBeenCalledTimes(1);
    expect(h.notifications.map((n) => n.title)).toEqual(["ETH/USDT: Price < SMA 20 · 1H"]);

    const preview = await api("preview", { target: "ETH/USDT", condition: "rsi(14,1h)>50" });
    expect(preview).toMatchObject({ symbol: "ETH/USDT", holds: false, observed: expect.stringMatching(/^RSI 14 · 1H \d/) });
    await expect(api("preview", { target: "ETH/USDT", condition: "rsi(14,2h)>50" })).rejects.toThrow(/Timeframe/);

    const [rsiAlert] = (await api("state", {}) as { alerts: Array<{ id: string; condition: string }> }).alerts;
    expect(await api("pause", { id: rsiAlert.id, paused: true })).toEqual({ paused: true });
    closes = [...closes.slice(0, -1), 180];
    prices["ETH/USDT"] = { price: 180 };
    expect(await check()).toBe("No active alert.");
    await api("pause", { id: rsiAlert.id, paused: false });
    /* Resumed while across: it waits for the next crossing. */
    expect(await check()).toMatch(/^1 alert\(s\) checked, 0 fired/);
  });
});
