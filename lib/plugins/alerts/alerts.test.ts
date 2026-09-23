import { describe, expect, it } from "vitest";
import { alertLine, newAlert, step, type Alert } from "./alerts";
import { evaluate, parseCondition, type AlertCondition, type Reading } from "./conditions";

const now = new Date("2026-09-23T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);
const HOUR = 3600_000;

const make = (condition: string, over: Partial<Parameters<typeof newAlert>[0]> = {}) => {
  const r = newAlert({ target: "btc", condition, ...over }, "a1", now);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const cond = (text: string) => parseCondition(text) as AlertCondition;

describe("alert conditions", () => {
  it("reads the watch grammar and its extensions", () => {
    expect(cond("price >= 70000")).toEqual({ kind: "until", until: { field: "price", op: ">=", value: 70000 } });
    expect(cond("change24h>5%")).toEqual({ kind: "change", window: "24h", op: ">", value: 5 });
    expect(cond("CHANGE1H <= -3")).toEqual({ kind: "change", window: "1h", op: "<=", value: -3 });
    expect(cond("funding>0.05%")).toEqual({ kind: "funding", op: ">", value: 0.05 });
    expect(cond("event<24h")).toEqual({ kind: "event", hours: 24 });
    expect(cond("closed")).toEqual({ kind: "until", until: { field: "closed" } });
    expect(parseCondition("event<500h")).toMatchObject({ error: expect.stringMatching(/between 1 and 168/) });
    expect(parseCondition("moon soon")).toMatchObject({ error: expect.stringMatching(/^Unreadable condition/) });
  });

  it("evaluates, or says what it could not read", () => {
    const r: Reading = { price: 71_000, change: { "24h": 6.2 }, funding: 0.03, events: [{ title: "FOMC", startsAt: new Date(now.getTime() + 5 * HOUR).toISOString() }] };
    expect(evaluate(cond("price>=70000"), r, now)).toEqual({ holds: true, observed: "price 71000" });
    expect(evaluate(cond("change24h>5%"), r, now)).toEqual({ holds: true, observed: "24h change +6.20 %" });
    expect(evaluate(cond("funding>0.05%"), r, now)).toEqual({ holds: false, observed: "funding 0.03 % / 8 h" });
    expect(evaluate(cond("event<6h"), r, now)).toEqual({ holds: true, observed: "FOMC in 5 h" });
    expect(evaluate(cond("event<4h"), r, now)).toMatchObject({ holds: false });
    expect(evaluate(cond("change7d>1%"), r, now)).toMatchObject({ error: expect.stringMatching(/No 7d change/) });
    expect(evaluate(cond("price>1"), { errors: { price: "No price for XYZ/USDT." } }, now)).toEqual({ error: "No price for XYZ/USDT." });
    expect(evaluate(cond("pnl<-50"), { price: 1 }, now)).toEqual({ error: "The position could not be read." });
    expect(evaluate(cond("pnl<-50"), { position: { open: true, pnl: -80 } }, now)).toEqual({ holds: true, observed: "PnL -80" });
    expect(evaluate(cond("liq<3%"), { position: { open: false } }, now)).toEqual({ holds: false, observed: "no open position" });
  });
});

describe("alerts", () => {
  it("checks what is created", () => {
    expect(make("price>=70000").alert).toMatchObject({ target: "BTC/USDT", condition: "price>=70000", once: true, status: "active", state: {} });
    expect(make("change24h>5%", { target: "Watchlist", once: false }).alert).toMatchObject({ target: "watchlist", once: false });
    expect(newAlert({ target: "not a pair!", condition: "price>1" }, "x", now)).toMatchObject({ error: expect.stringMatching(/^Not a pair/) });
    expect(newAlert({ target: "watchlist", condition: "pnl<-5", accountId: "acc" }, "x", now)).toMatchObject({ error: expect.stringMatching(/one pair/) });
    expect(newAlert({ target: "BTC", condition: "pnl<-5" }, "x", now)).toMatchObject({ error: expect.stringMatching(/needs the exchange account/) });
    expect(make("pnl<-5", { accountId: "acc" }).alert.accountId).toBe("acc");
  });

  it("fires once per crossing, not at every evaluation", () => {
    let a: Alert = make("price>=70000", { once: false }).alert;
    const at = (price: number, t: Date) => {
      const s = step(a, "BTC/USDT", evaluate(cond("price>=70000"), { price }, t), t, 0);
      a = s.alert;
      return s.trigger;
    };
    expect(at(69_000, now)).toBeUndefined();
    expect(at(70_500, later(1))).toMatchObject({ symbol: "BTC/USDT", observed: "price 70500", condition: "price>=70000" });
    expect(at(71_000, later(2))).toBeUndefined();
    expect(at(69_900, later(3))).toBeUndefined();
    expect(at(70_100, later(4))).toBeDefined();
  });

  it("fires at once if already true, then is done when one-shot", () => {
    let a = make("price>=70000").alert;
    const s = step(a, "BTC/USDT", { holds: true, observed: "price 71000" }, now, 0);
    expect(s.trigger).toBeDefined();
    a = s.alert;
    expect(a.status).toBe("done");
    a = step(a, "BTC/USDT", { holds: false, observed: "" }, later(1), 0).alert;
    expect(step(a, "BTC/USDT", { holds: true, observed: "" }, later(2), 0).trigger).toBeUndefined();
  });

  it("keeps quiet during the cooldown, and a crossing in it is swallowed", () => {
    let a = make("change1h>2%", { once: false }).alert;
    a = step(a, "BTC/USDT", { holds: true, observed: "" }, now, HOUR).alert;
    a = step(a, "BTC/USDT", { holds: false, observed: "" }, later(10), HOUR).alert;
    const inCooldown = step(a, "BTC/USDT", { holds: true, observed: "" }, later(20), HOUR);
    expect(inCooldown.trigger).toBeUndefined();
    a = step(inCooldown.alert, "BTC/USDT", { holds: false, observed: "" }, later(70), HOUR).alert;
    expect(step(a, "BTC/USDT", { holds: true, observed: "" }, later(80), HOUR).trigger).toBeDefined();
  });

  it("`closed` waits for a position to have been open", () => {
    let a = make("closed", { accountId: "acc" }).alert;
    const s0 = step(a, "BTC/USDT", { holds: true, observed: "no open position" }, now, 0);
    expect(s0.trigger).toBeUndefined();
    a = step(s0.alert, "BTC/USDT", { holds: false, observed: "PnL 5" }, later(1), 0).alert;
    expect(step(a, "BTC/USDT", { holds: true, observed: "no open position" }, later(2), 0).trigger).toBeDefined();
  });

  it("says once that an alert cannot be evaluated, and forgets it when it can", () => {
    let a = make("price>=70000").alert;
    const f1 = step(a, "BTC/USDT", { error: "No price for BTC/USDT." }, now, 0);
    expect(f1.failing).toBe("No price for BTC/USDT.");
    const f2 = step(f1.alert, "BTC/USDT", { error: "No price for BTC/USDT." }, later(1), 0);
    expect(f2.failing).toBeUndefined();
    expect(alertLine(f2.alert)).toContain("CANNOT EVALUATE: No price for BTC/USDT.");
    a = step(f2.alert, "BTC/USDT", { holds: false, observed: "price 1" }, later(2), 0).alert;
    expect(a.errors).toBeUndefined();
  });
});
