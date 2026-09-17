import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "./client";
import { watchTool } from "./watch";
import { ctx, fakeExchange } from "./test-fixture";
import type { AgentEvent } from "@/lib/agent/events";

vi.mock("./client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);

beforeEach(() => {
  mocked.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const lines = (events: AgentEvent[]) => events.filter((e) => e.type === "tool_line").map((e) => (e as { line: string }).line);

describe("ExchangeWatch", () => {
  test("s'arrete quand la condition est atteinte, une ligne par releve", async () => {
    let n = 0;
    const ex = fakeExchange({ fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: [66000, 70500][n++] })) });
    mocked.mockResolvedValue(ex);
    const events: AgentEvent[] = [];
    const p = watchTool.execute({ symbol: "BTC/USDT", every: 5, until: "price>=70000" }, ctx(undefined, events));
    await vi.advanceTimersByTimeAsync(6000);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(lines(events)).toHaveLength(2);
    expect(lines(events)[1]).toMatch(/mark 70500$/);
    expect(r.output.endsWith("Arrêt : condition `price>=70000` atteinte.")).toBe(true);
  });
  test("temps ecoule", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const events: AgentEvent[] = [];
    const p = watchTool.execute({ symbol: "BTC/USDT", every: 5, timeout: 12000 }, ctx(undefined, events));
    await vi.advanceTimersByTimeAsync(13000);
    const r = await p;
    expect(lines(events).length).toBeGreaterThanOrEqual(2);
    expect(r.output).toContain("Arrêt : temps écoulé (12 s).");
  });
  test("futures : PnL et liquidation dans la ligne, arret quand la position se ferme", async () => {
    let n = 0;
    const ex = fakeExchange({
      fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT:USDT", last: 67000 })),
      fetchPositions: vi.fn(async () => (n++ === 0 ? [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, liquidationPrice: 52000 }] : [])),
    });
    mocked.mockResolvedValue(ex);
    const events: AgentEvent[] = [];
    const p = watchTool.execute({ symbol: "BTC/USDT", market: "futures", every: 5 }, ctx(undefined, events));
    await vi.advanceTimersByTimeAsync(6000);
    const r = await p;
    expect(lines(events)[0]).toMatch(/mark 67000 · PnL \+100 \(\+3\.08 %\) · liquidation à 22\.39 %$/);
    expect(r.output).toContain("Arrêt : position fermée.");
  });
  test("until illisible : refus immediat", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const r = await watchTool.execute({ symbol: "BTC/USDT", until: "volume>1" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("illisible");
  });
  test("annulation par le signal", async () => {
    mocked.mockResolvedValue(fakeExchange());
    const ac = new AbortController();
    const c = { ...ctx(), signal: ac.signal };
    const p = watchTool.execute({ symbol: "BTC/USDT", every: 5 }, c);
    await vi.advanceTimersByTimeAsync(1000);
    ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    expect(r.output).toContain("Arrêt : interrompu.");
  });
});
