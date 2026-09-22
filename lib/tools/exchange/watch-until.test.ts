import { describe, expect, test } from "vitest";
import { holds, parseUntil, type Sample } from "./watch-until";

const sample = (over: Partial<Sample> = {}): Sample => ({ price: 67000, pnl: 100, pnlPct: 3.08, liqPct: 22.39, open: true, ...over });

describe("parseUntil", () => {
  test("the four fields, the four operators, the %", () => {
    expect(parseUntil("price>=70000")).toEqual({ field: "price", op: ">=", value: 70000 });
    expect(parseUntil("pnl < -50")).toEqual({ field: "pnl", op: "<", value: -50 });
    expect(parseUntil("pnl% <= -2.5")).toEqual({ field: "pnlPct", op: "<=", value: -2.5 });
    expect(parseUntil("liq<3%")).toEqual({ field: "liqPct", op: "<", value: 3 });
    expect(parseUntil("closed")).toEqual({ field: "closed" });
  });
  test("invalid expression", () => {
    expect(parseUntil("price = 1")).toEqual({ error: 'Unreadable `until` condition: "price = 1". Expected: `price>=70000`, `pnl<-50`, `pnl%<-2`, `liq<3%` or `closed`.' });
    expect(parseUntil("volume>1")).toHaveProperty("error");
  });
});

describe("holds", () => {
  test("compares the right field", () => {
    expect(holds({ field: "price", op: ">=", value: 67000 }, sample())).toBe(true);
    expect(holds({ field: "price", op: ">", value: 67000 }, sample())).toBe(false);
    expect(holds({ field: "pnl", op: "<", value: -50 }, sample({ pnl: -60 }))).toBe(true);
    expect(holds({ field: "pnlPct", op: "<=", value: -2 }, sample({ pnlPct: -2 }))).toBe(true);
  });
  test("liq: absolute distance to liquidation", () => {
    expect(holds({ field: "liqPct", op: "<", value: 3 }, sample({ liqPct: -2.5 }))).toBe(true);
    expect(holds({ field: "liqPct", op: "<", value: 3 }, sample({ liqPct: 22 }))).toBe(false);
  });
  test("missing data: false; closed: position closed", () => {
    expect(holds({ field: "pnl", op: "<", value: 0 }, sample({ pnl: undefined }))).toBe(false);
    expect(holds({ field: "closed" }, sample({ open: false }))).toBe(true);
    expect(holds({ field: "closed" }, sample())).toBe(false);
  });
});
