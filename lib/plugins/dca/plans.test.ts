import { describe, expect, it } from "vitest";
import { advance, changePlan, dueNow, newPlan, readOrderOutcome, summarize, type DcaPlan, type Purchase } from "./plans";
import { planLine, purchaseLine } from "./present";

const now = new Date(2026, 8, 23, 10, 0);
const plan = (over: Record<string, unknown> = {}) => newPlan({ symbol: "btc", quoteAmount: 100, frequency: "every monday at 09:00", destination: "paper", ...over }, "p1", now) as DcaPlan;
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);

describe("DCA plans", () => {
  it("checks a plan and computes its first due date", () => {
    expect(plan()).toMatchObject({ symbol: "BTC/USDT", quoteAmount: 100, destination: "paper", status: "active", nextDue: at(28, 9).toISOString() });
    expect(plan({ frequency: "every 7 days" }).nextDue).toBe(now.toISOString());
    expect(plan({ startAt: at(30, 0).toISOString() }).nextDue).toBe(new Date(2026, 9, 5, 9).toISOString());
    expect(newPlan({ symbol: "btc", quoteAmount: 0, frequency: "daily at 08:00", destination: "paper" }, "x", now)).toMatchObject({ error: expect.stringMatching(/amount to spend/) });
    expect(newPlan({ symbol: "btc", quoteAmount: 10, frequency: "every 30 minutes", destination: "paper" }, "x", now)).toMatchObject({ error: expect.stringMatching(/every hour/) });
    expect(newPlan({ symbol: "btc", quoteAmount: 10, frequency: "daily at 08:00", destination: "moon" }, "x", now)).toMatchObject({ error: expect.stringMatching(/Choose where/) });
    expect(newPlan({ symbol: "btc", quoteAmount: 10, frequency: "daily at 08:00", destination: "exchange" }, "x", now)).toMatchObject({ error: expect.stringMatching(/needs the exchange account/) });
    expect(newPlan({ symbol: "btc", quoteAmount: 10, frequency: "daily at 08:00", destination: "paper", endAt: at(1, 0).toISOString() }, "x", now)).toMatchObject({ error: expect.stringMatching(/end must come after/) });
  });

  it("is due at its date; a date missed while closed is late, and not made up twice", () => {
    const p = plan();
    expect(dueNow(p, at(28, 8, 59))).toBeNull();
    expect(dueNow(p, at(28, 9, 5))).toEqual({ due: at(28, 9).toISOString(), late: false });
    expect(dueNow(p, new Date(2026, 9, 14, 12))).toEqual({ due: at(28, 9).toISOString(), late: true });
    expect(advance(p, new Date(2026, 9, 14, 12)).nextDue).toBe(new Date(2026, 9, 19, 9).toISOString());
    expect(advance(plan({ endAt: at(30, 0).toISOString() }), at(28, 9, 1))).toMatchObject({ status: "ended" });
    expect(advance(plan({ endAt: at(30, 0).toISOString() }), at(28, 9, 1)).nextDue).toBeUndefined();
  });

  it("pauses, resumes from the next date after now, deletes", () => {
    const p = plan();
    const paused = changePlan([p], "p1", "pause", now);
    expect("plan" in paused && paused.plan.status).toBe("paused");
    const resumed = changePlan("plans" in paused ? paused.plans : [], "p1", "resume", new Date(2026, 9, 14, 12));
    expect(resumed).toMatchObject({ plan: { status: "active", nextDue: new Date(2026, 9, 19, 9).toISOString() } });
    expect(changePlan([p], "p1", "delete", now)).toMatchObject({ plans: [] });
    expect(changePlan([p], "p9", "pause", now)).toMatchObject({ error: expect.stringMatching(/No DCA plan/) });
  });

  it("the average price and the total invested are exact on the fills", () => {
    const buy = (amount: number, price: number, status: Purchase["status"] = "filled"): Purchase => ({ id: String(amount), planId: "p1", due: "", at: "", mode: "paper", status, amount, price });
    const s = summarize([buy(0.002, 50_000), buy(0.0025, 40_000), buy(1, 1, "refused"), { ...buy(0, 0, "proposed"), amount: undefined, price: undefined }]);
    expect(s.purchases).toBe(2);
    expect(s.invested).toBeCloseTo(200, 10);
    expect(s.amount).toBeCloseTo(0.0045, 12);
    expect(s.average).toBeCloseTo(200 / 0.0045, 6);
    expect(s.pending).toBe(1);
    expect(summarize([])).toEqual({ purchases: 0, invested: 0, amount: 0, pending: 0 });
  });

  it("reads the fill of a confirmed PlaceOrder", () => {
    expect(readOrderOutcome("Order #123 closed · BUY 0.0015 BTC/USDT market · average 65000.5 · filled 0.0015")).toEqual({ amount: 0.0015, price: 65000.5 });
    expect(readOrderOutcome("Order #1 open · BUY 1e-7 X/USDT market · filled 1e-7")).toEqual({ amount: 1e-7 });
    expect(readOrderOutcome("Refused")).toEqual({});
  });

  it("in words", () => {
    const p = plan();
    expect(planLine(p, [], [])).toBe(`- [p1] 100 USDT of BTC/USDT, every monday at 09:00, into the paper portfolio — next ${at(28, 9).toISOString().slice(0, 16).replace("T", " ")} UTC; nothing bought yet`);
    expect(purchaseLine({ id: "x", planId: "p1", due: "2026-09-28T07:00:00.000Z", at: "", mode: "live", status: "proposed", late: true })).toBe("2026-09-28 07:00 UTC [live] awaiting confirmation (missed while the app was closed)");
  });
});
