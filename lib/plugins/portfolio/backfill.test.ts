import { describe, expect, it } from "vitest";
import { balancesByDay, flowsByDay, lastDays, mergeHistory, valueByDay } from "./backfill";

const D = 86_400_000;
const t0 = Date.parse("2026-09-20T00:00:00Z");
const bars = (closes: number[], from = t0) => closes.map((c, i) => ({ t: from + i * D, o: c, h: c, l: c, c, v: 0 }));

describe("mergeHistory", () => {
  it("puts a real snapshot in place of its estimated day", () => {
    const est = [{ date: "2026-09-21", at: "", totalUsd: 1, assets: {} }, { date: "2026-09-22", at: "", totalUsd: 2, assets: {} }];
    const real = [{ date: "2026-09-22", at: "", totalUsd: 5, assets: {} }, { date: "2026-09-23", at: "", totalUsd: 6, assets: {} }];
    expect(mergeHistory(real, est).map((p) => [p.date, p.totalUsd])).toEqual([
      ["2026-09-21", 1],
      ["2026-09-22", 5],
      ["2026-09-23", 6],
    ]);
  });
});

describe("the real history, from a ledger", () => {
  const days = ["2026-09-20", "2026-09-21", "2026-09-22"];
  const at = (day: string, h: number) => Date.parse(`${day}T${String(h).padStart(2, "0")}:00:00Z`);

  it("walks the moves back from today's balances", () => {
    /* On the 21st, 100 USDT bought 0.001 BTC; on the 22nd, 0.0005 BTC sold for 55 USDT. */
    const moves = [
      { t: at("2026-09-21", 10), asset: "USDT", delta: -100 },
      { t: at("2026-09-21", 10), asset: "BTC", delta: 0.001 },
      { t: at("2026-09-22", 9), asset: "BTC", delta: -0.0005 },
      { t: at("2026-09-22", 9), asset: "USDT", delta: 55 },
    ];
    const b = balancesByDay({ BTC: 0.0005, USDT: 55 }, moves, days);
    expect(b["2026-09-22"]).toEqual({ BTC: 0.0005, USDT: 55 });
    expect(b["2026-09-21"].BTC).toBeCloseTo(0.001, 12);
    expect(b["2026-09-21"].USDT).toBe(0);
    expect(b["2026-09-20"]).toEqual({ BTC: 0, USDT: 100 });
  });

  it("values each day at its close, the latest before when a day is missing", () => {
    const closes = { BTC: bars([100_000, 110_000], t0) };
    const { values, missing } = valueByDay({ "2026-09-20": { BTC: 0.001, USDT: 5 }, "2026-09-22": { BTC: 0.001, ETH: 1 } }, closes);
    expect(values).toEqual({ "2026-09-20": 105, "2026-09-22": 110 });
    expect(missing).toEqual(["ETH"]);
  });

  it("names the last days", () => {
    expect(lastDays(new Date("2026-09-24T10:00:00Z"), 3)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
  });
});

describe("flowsByDay", () => {
  it("counts deposits in and withdrawals out, in USD at the day's close, per account", () => {
    const t = (day: string) => Date.parse(`${day}T12:00:00Z`);
    const flows = flowsByDay(
      [
        { t: t("2026-09-20"), kind: "deposit", asset: "USDT", amount: 100, account: "a" },
        { t: t("2026-09-21"), kind: "withdrawal", asset: "BTC", amount: 0.001, account: "a" },
        { t: t("2026-09-21"), kind: "buy", asset: "BTC", amount: 1, account: "a" },
        { t: t("2026-09-21"), kind: "deposit", asset: "XYZ", amount: 5, account: "b" },
      ],
      { BTC: bars([100_000, 110_000]) },
    );
    expect(flows).toEqual({ a: { "2026-09-20": 100, "2026-09-21": -110 } });
  });
});
