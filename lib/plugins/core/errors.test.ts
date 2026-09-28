import { afterEach, describe, expect, it } from "vitest";
import { dcaPlugin } from "../dca";
import { paperTradingPlugin } from "../paper-trading";
import { portfolioPlugin } from "../portfolio";
import { schedulerPlugin } from "../scheduler";
import { harness, type Harness } from "../test-fixture";
import type { ApiRequest } from "./contract";
import { NotFoundError, actionStatus } from "./errors";

let h: Harness;
afterEach(async () => h?.close());

const REQ = { transport: { openrouterKey: "", bytnodeKey: "", exchangeAccounts: [], plugins: null }, signal: new AbortController().signal } as unknown as ApiRequest;
/** The status the route answers for this action's failure. */
const statusOf = async (plugin: string, action: string, params: Record<string, unknown>) => {
  try {
    await h.runtime.handler(plugin, action)!(params, REQ);
    return 200;
  } catch (e) {
    return actionStatus(e);
  }
};

describe("actionStatus", () => {
  it("a refusal is 400, an unknown id 404, a real fault 500, a busy store 503", () => {
    expect(actionStatus(new Error("Give the group a name."))).toBe(400);
    expect(actionStatus(new NotFoundError("gone"))).toBe(404);
    expect(actionStatus(new Error("No such group."))).toBe(404);
    expect(actionStatus(new TypeError("x is undefined"))).toBe(500);
    expect(actionStatus(new RangeError("Invalid time value"))).toBe(500);
    expect(actionStatus(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }))).toBe(500);
    expect(actionStatus(new Error("Busy: plans.json is locked by another process."))).toBe(503);
    expect(actionStatus(Object.assign(new Error("UNC path refused"), { name: "WorkspaceError" }))).toBe(400);
  });

  it("F1: the shipped views' bad input is a 400, their unknown ids a 404", async () => {
    h = await harness([portfolioPlugin, paperTradingPlugin, dcaPlugin, schedulerPlugin]);
    expect(await statusOf("portfolio", "group", { action: "create", name: "" })).toBe(400);
    expect(await statusOf("portfolio", "group", { action: "fly" })).toBe(400);
    expect(await statusOf("portfolio", "group", { action: "delete", id: "missing" })).toBe(404);
    expect(await statusOf("paper-trading", "rename", { portfolio: "no-such", name: "x" })).toBe(404);
    expect(await statusOf("dca", "update", { id: "nope", action: "pause" })).toBe(404);
    expect(await statusOf("dca", "group", { action: "delete", id: "nope" })).toBe(404);
    expect(await statusOf("dca", "create", { symbol: "BTC/USDT", quoteAmount: -5, frequency: "every 7 days", destination: "paper" })).toBe(400);
    expect(await statusOf("scheduler", "update", { id: "nope", action: "pause" })).toBe(404);
    expect(await statusOf("scheduler", "run-now", { id: "nope" })).toBe(404);
  });
});
