import { vi } from "vitest";
import type { Exchange } from "ccxt";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { ToolContext } from "../types";
import type { AgentEvent } from "@/lib/agent/events";

/* The stage set for the exchange tool tests: a fake ccxt client, never any
   network. `clientFor` is replaced by `vi.mock("./client")` in each test
   file, then pointed at `fakeExchange(...)`. */

export const MAIN: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false };
export const TESTNET: ExchangeAccount = { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "", testnet: true };

export const ctx = (accounts: ExchangeAccount[] = [MAIN], events: AgentEvent[] = []): ToolContext => ({
  workspace: "C:/w",
  scope: "workspace",
  projectRoot: "C:/p",
  signal: new AbortController().signal,
  emit: (e) => events.push(e),
  depth: 0,
  llm: { apiKey: "", model: "m", effort: null },
  callId: "c1",
  exchangeAccounts: accounts,
});

export const ccxtError = (name: string, message = name) => Object.assign(new Error(message), { name });

type Overrides = Partial<Record<string, unknown>>;

/** A fake exchange: BTC/USDT and its perp, 5-decimal precision, minimum
    0.0001. Every method is a replaceable `vi.fn`. */
export function fakeExchange(over: Overrides = {}): Exchange {
  const market = (symbol: string, swap: boolean) => ({
    symbol,
    id: symbol.replace("/", "").replace(":USDT", ""),
    settle: swap ? "USDT" : undefined,
    base: "BTC",
    quote: "USDT",
    swap,
    spot: !swap,
    precision: { amount: 5, price: 2 },
    limits: { amount: { min: 0.0001 } },
  });
  const base = {
    id: "binance",
    has: { fetchPositions: true, fetchPositionMode: true, fetchTickers: true, fetchFundingRate: true, fetchClosedOrders: true, cancelAllOrders: true, transfer: true, setLeverage: true, setMarginMode: true },
    markets: {
      "BTC/USDT": market("BTC/USDT", false),
      "BTC/USDT:USDT": market("BTC/USDT:USDT", true),
      "ETH/USDT": { ...market("ETH/USDT", false), base: "ETH" },
    },
    amountToPrecision: (_s: string, a: number) => Number(a).toFixed(5).replace(/0+$/, "").replace(/\.$/, ""),
    priceToPrecision: (_s: string, p: number) => Number(p).toFixed(2),
    fetchBalance: vi.fn(async () => ({ total: {}, free: {}, used: {} })),
    fetchTickers: vi.fn(async () => ({})),
    fetchTicker: vi.fn(async () => ({ symbol: "BTC/USDT", last: 50000 })),
    fetchOrderBook: vi.fn(async () => ({ bids: [], asks: [] })),
    fetchFundingRate: vi.fn(async () => ({ fundingRate: 0.0001 })),
    fetchPositions: vi.fn(async () => []),
    fetchPositionMode: vi.fn(async () => ({ hedged: false })),
    fetchOpenOrders: vi.fn(async () => []),
    fetchClosedOrders: vi.fn(async () => []),
    fetchOrders: vi.fn(async () => []),
    createOrder: vi.fn(async () => ({ id: "o1", status: "closed", amount: 0.004, filled: 0.004, average: 50000 })),
    cancelOrder: vi.fn(async () => ({})),
    cancelAllOrders: vi.fn(async () => []),
    transfer: vi.fn(async () => ({ id: "t1" })),
    setLeverage: vi.fn(async () => ({})),
    setMarginMode: vi.fn(async () => ({})),
  };
  return { ...base, ...over } as unknown as Exchange;
}
