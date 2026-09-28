import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientFor } from "@/lib/tools/exchange/client";
import { placeOrderTool } from "@/lib/tools/exchange/place-order";
import { transferTool } from "@/lib/tools/exchange/transfer";
import { ctx, fakeExchange, TESTNET } from "@/lib/tools/exchange/test-fixture";
import { ok, type Tool } from "@/lib/tools/types";
import { serveCall, type Confirm } from "./serve-call";

/* The guarantee for subscription agents: our MCP server never runs a money
   action before BytNode-AI's user has confirmed it — whatever the agent
   decided on its own. A fake exchange: never any network. */

vi.mock("@/lib/tools/exchange/client", () => ({ clientFor: vi.fn() }));
const mocked = vi.mocked(clientFor);

const ORDER = { symbol: "BTC/USDT", side: "buy", type: "market", amount: 0.001 };

beforeEach(() => mocked.mockReset());

describe("serveCall: a money action", () => {
  test("without anyone to confirm (a sub-agent's server): refused, the exchange is never reached", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r = await serveCall(placeOrderTool as Tool, ORDER, ctx([TESTNET]), null);
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/^PlaceOrder was NOT executed: the user must confirm it in BytNode-AI\. Nobody can confirm it here/) });
    expect(mocked).not.toHaveBeenCalled();
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  test("denied, timed out or no live turn: refused with the reason, nothing sent", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    for (const reason of ["The user denied it: nothing was sent.", "No answer from the user in 10 minutes: nothing was sent.", "No turn of this conversation is running in BytNode-AI, so nobody can confirm the action: nothing was sent."]) {
      const confirm = vi.fn<Confirm>(async () => ({ allowed: false, reason }));
      const r = await serveCall(placeOrderTool as Tool, ORDER, ctx([TESTNET]), confirm);
      expect(confirm).toHaveBeenCalledWith("PlaceOrder", ORDER, expect.any(AbortSignal));
      expect(r.isError).toBe(true);
      expect((r.content[0] as { text: string }).text).toContain(reason);
    }
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  test("a confirmation that throws, or answers anything but a plain yes, is a refusal", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const r1 = await serveCall(placeOrderTool as Tool, ORDER, ctx([TESTNET]), async () => {
      throw new Error("socket hang up");
    });
    const r2 = await serveCall(placeOrderTool as Tool, ORDER, ctx([TESTNET]), async () => ({ allowed: "true" }) as never);
    expect(r1.isError && r2.isError).toBe(true);
    expect((r1.content[0] as { text: string }).text).toContain("socket hang up");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  test("confirmed: runs, once", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const confirm = vi.fn<Confirm>(async () => ({ allowed: true }));
    const r = await serveCall(placeOrderTool as Tool, ORDER, ctx([TESTNET]), confirm);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).toHaveBeenCalledTimes(1);
    expect(r.isError).toBe(false);
  });

  test("Transfer asks too; ill-formed arguments are refused before anyone is asked", async () => {
    const ex = fakeExchange();
    mocked.mockResolvedValue(ex);
    const confirm = vi.fn<Confirm>(async () => ({ allowed: false, reason: "no" }));
    await serveCall(transferTool as Tool, { asset: "USDT", amount: 5, from: "spot", to: "futures" }, ctx([TESTNET]), confirm);
    expect(confirm).toHaveBeenCalledWith("Transfer", expect.anything(), expect.any(AbortSignal));
    confirm.mockClear();
    const bad = await serveCall(placeOrderTool as Tool, { side: "buy" }, ctx([TESTNET]), confirm);
    expect(bad.isError).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(ex.transfer).not.toHaveBeenCalled();
  });
});

describe("serveCall: any other tool", () => {
  test("runs without asking anyone", async () => {
    const execute = vi.fn(async () => ok("42"));
    const tool: Tool = { name: "PositionSize", description: "", parameters: { type: "object", properties: {} }, policy: { readOnly: true }, execute };
    const gated: Tool = { name: "WatchlistEdit", description: "", parameters: { type: "object", properties: {} }, policy: { gated: true }, execute };
    const confirm = vi.fn<Confirm>();
    expect(await serveCall(tool, {}, ctx(), confirm)).toEqual({ content: [{ type: "text", text: "42" }], isError: false });
    await serveCall(gated, {}, ctx(), confirm);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });
});
