import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Confirmation } from "@/lib/domain/plugins";
import { clientFor } from "@/lib/tools/exchange/client";
import { MAIN, TESTNET, fakeExchange } from "@/lib/tools/exchange/test-fixture";
import { runConfirmed } from "./run-confirmed";

vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);
beforeEach(() => mocked.mockReset());

const parked = (over: Partial<Confirmation> = {}): Confirmation => ({
  id: "c1",
  at: 0,
  plugin: "dca",
  tool: "PlaceOrder",
  args: { symbol: "BTC/USDT", side: "buy", type: "market", quoteAmount: 200 },
  accountId: MAIN.id,
  title: "DCA purchase",
  reason: "Weekly plan.",
  status: "allowed",
  ...over,
});
const signal = new AbortController().signal;

describe("runConfirmed", () => {
  it("runs the parked order through the core's PlaceOrder, on the named account", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await runConfirmed(parked(), [TESTNET, MAIN], signal);
    expect(r.ok).toBe(true);
    expect(mocked).toHaveBeenCalledWith(MAIN, "spot");
    expect(ex.createOrder).toHaveBeenCalledWith("BTC/USDT", "market", "buy", 0.004, undefined, expect.any(Object));
  });

  it("refuses when the named account is not the one the browser sent", async () => {
    const r = await runConfirmed(parked(), [TESTNET], signal);
    expect(r).toEqual({ ok: false, output: "The exchange account of this order is no longer configured in this browser." });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("only runs a tool that always asks", async () => {
    for (const tool of ["CancelOrder", "SetLeverage", "Bash"]) {
      const r = await runConfirmed(parked({ tool }), [MAIN], signal);
      expect(r.output).toBe(`${tool} cannot be run from a confirmation.`);
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it("checks the parked arguments before calling the exchange", async () => {
    const r = await runConfirmed(parked({ args: { symbol: "BTC/USDT", side: "hold", type: "market", amount: 1 } }), [MAIN], signal);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/^Invalid order: /);
    expect(mocked).not.toHaveBeenCalled();
  });
});
