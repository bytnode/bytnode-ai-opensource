import { describe, expect, it } from "vitest";
import { alertLine, newAlert, step, type Alert } from "./alerts";
import { conditionText, describeCondition, evaluate, parseCondition, waitsForCrossing, type AlertCondition, type Reading } from "./conditions";
import { metricKey, metricLabel, parseMetric } from "./metrics";

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
    /* A level in scientific notation is a number, not a metric named "1e9". */
    expect(parseCondition("price>1e9")).toMatchObject({ kind: "compare", right: { value: 1e9 } });
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

describe("metrics and indicator conditions", () => {
  it("reads a metric with its parameters, or its defaults", () => {
    expect(parseMetric("RSI(14, 1H)")).toEqual({ kind: "rsi", length: 14, tf: "1h" });
    expect(parseMetric("rsi")).toEqual({ kind: "rsi", length: 14, tf: "1h" });
    expect(parseMetric("ema(200,4h)")).toEqual({ kind: "ema", length: 200, tf: "4h" });
    expect(parseMetric("macd(12,26,9,1d).signal")).toEqual({ kind: "macd", fast: 12, slow: 26, signal: 9, tf: "1d", line: "signal" });
    expect(parseMetric("macd")).toMatchObject({ kind: "macd", line: "hist" });
    expect(parseMetric("bb(20,2.5,15m).lower")).toEqual({ kind: "bb", length: 20, mult: 2.5, tf: "15m", band: "lower" });
    expect(parseMetric("stoch(14,3,1h).d")).toEqual({ kind: "stoch", length: 14, smooth: 3, tf: "1h", line: "d" });
    expect(parseMetric("volume(4h)")).toEqual({ kind: "volume", tf: "4h" });
    expect(parseMetric("change24h")).toEqual({ kind: "change", window: "24h" });
    expect(parseMetric("rsi(14,3h)")).toMatchObject({ error: expect.stringMatching(/^Timeframe/) });
    expect(parseMetric("bb(20,2,1h)")).toMatchObject({ error: expect.stringMatching(/\.upper, \.middle or \.lower/) });
    expect(parseMetric("macd(26,12,9)")).toMatchObject({ error: expect.stringMatching(/fast < slow/) });
    expect(parseMetric("vibes")).toMatchObject({ error: 'Unknown metric "vibes".' });
    for (const t of ["rsi(14,1h)", "macd(12,26,9,4h).hist", "bb(20,2,1h).upper", "stoch(14,3,15m).k", "volume(1d)", "change7d", "funding", "price"]) expect(metricKey(parseMetric(t) as never)).toBe(t);
    expect(metricLabel(parseMetric("rsi(14,1h)") as never)).toBe("RSI 14 · 1H");
  });

  it("a metric against a level or another metric; `crosses_*` waits for a crossing", () => {
    const rsiUnder = cond("rsi(14,1h) < 30");
    expect(rsiUnder).toEqual({ kind: "compare", left: { kind: "rsi", length: 14, tf: "1h" }, op: "<", right: { value: 30 } });
    const golden = cond("EMA(50,1d) crosses above ema(200,1d)");
    expect(golden).toMatchObject({ kind: "compare", op: "crosses_above", right: { metric: { kind: "ema", length: 200 } } });
    expect(conditionText(golden, "")).toBe("ema(50,1d) crosses_above ema(200,1d)");
    expect(describeCondition(golden)).toBe("EMA 50 · 1D crosses above EMA 200 · 1D");
    expect(describeCondition(cond("change24h crosses_below -5"))).toBe("24h change crosses below -5 %");
    expect(waitsForCrossing(golden)).toBe(true);
    expect(waitsForCrossing(rsiUnder)).toBe(false);
    /* The legacy forms keep their meaning. */
    expect(cond("price>=70000")).toMatchObject({ kind: "until" });
    expect(cond("price crosses_above 70000")).toMatchObject({ kind: "compare", left: { kind: "price" } });
    expect(parseCondition("rsi(14,1h) < soon")).toMatchObject({ error: expect.stringMatching(/Unknown metric "soon"/) });

    const r: Reading = { price: 64_000, values: { "rsi(14,1h)": 27.456, "ema(50,1d)": 61_000 }, errors: { values: { "ema(200,1d)": "Not enough 1d candles." } } };
    expect(evaluate(rsiUnder, r, now)).toEqual({ holds: true, observed: "RSI 14 · 1H 27.456" });
    expect(evaluate(cond("price>ema(50,1d)"), r, now)).toEqual({ holds: true, observed: "Price 64000, EMA 50 · 1D 61000" });
    expect(evaluate(golden, r, now)).toEqual({ error: "Not enough 1d candles." });
    expect(evaluate(cond("atr(14,1h)>1"), r, now)).toEqual({ error: "No value for ATR 14 · 1H." });
  });

  it("a crossing set while already across fires only on the next one", () => {
    let a = make("rsi(14,1h) crosses_below 30", { once: false }).alert;
    expect(a.condition).toBe("rsi(14,1h) crosses_below 30");
    const at = (holds: boolean, t: Date) => {
      const s = step(a, "BTC/USDT", { holds, observed: holds ? "RSI 14 · 1H 25" : "RSI 14 · 1H 40" }, t, 0);
      a = s.alert;
      return s.trigger;
    };
    expect(at(true, now)).toBeUndefined();
    expect(a.state["BTC/USDT"]).toMatchObject({ holds: true, observed: "RSI 14 · 1H 25", checkedAt: now.toISOString() });
    expect(at(false, later(1))).toBeUndefined();
    expect(at(true, later(2))).toMatchObject({ condition: "rsi(14,1h) crosses_below 30" });
  });
});
