import { describe, expect, it } from "vitest";
import { addBalances, earnByDay, savingsByDay, tradingPart } from "./savings";

const at = (day: string, h = 12) => Date.parse(`${day}T${String(h).padStart(2, "0")}:00:00Z`);
const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

describe("earnByDay", () => {
  it("reads a row as the balance of the day before, today's after the last", () => {
    const rows = [
      { t: at("2026-06-03", 1), coin: "USDT", staked: 500 },
      { t: at("2026-06-04", 1), coin: "USDT", staked: 400 },
    ];
    const e = earnByDay(rows, {}, days);
    expect(days.map((d) => e[d].USDT ?? 0)).toEqual([0, 500, 400, 0, 0]);
  });
});

describe("savingsByDay", () => {
  /* 500 deposited on the 1st, put in Earn on the 2nd; 100 of it spent by
     card on the 4th (Earn down, no record); today: 0 in Funding, 400 in Earn. */
  const inputs = {
    fundNow: {},
    earnNow: { USDT: 400 },
    earnRows: [
      { t: at("2026-06-03", 1), coin: "USDT", staked: 500 },
      { t: at("2026-06-04", 1), coin: "USDT", staked: 500 },
      { t: at("2026-06-05", 1), coin: "USDT", staked: 400 },
    ],
    events: [{ t: at("2026-06-01"), coin: "USDT", delta: 500 }],
  };

  it("keeps the deposit in the pot from its day on", () => {
    const s = savingsByDay(inputs, days);
    expect(days.map((d) => s.balances[d].USDT ?? 0)).toEqual([500, 500, 500, 400, 400]);
  });

  it("reports the money gone without a record, on its day", () => {
    expect(savingsByDay(inputs, days).unexplained).toEqual([{ day: "2026-06-04", coin: "USDT", amount: -100 }]);
  });

  it("follows money moved to the trading account as known", () => {
    /* The 100 went to the trading account instead (TRANSFER_IN there). */
    const s = savingsByDay({ ...inputs, events: [...inputs.events, { t: at("2026-06-04"), coin: "USDT", delta: -100 }] }, days);
    expect(s.unexplained).toEqual([]);
    expect(s.balances["2026-06-04"].USDT).toBe(400);
  });

  it("counts interest as the pot's gain, not as money moved", () => {
    /* The row paid on the 3rd earned on the 2nd's 100; the 1 it pays is in
       Earn from the 3rd on. */
    const s = savingsByDay({ fundNow: {}, earnNow: { USDT: 101 }, earnRows: [{ t: at("2026-06-02", 1), coin: "USDT", staked: 100 }, { t: at("2026-06-03", 1), coin: "USDT", staked: 100 }], events: [{ t: at("2026-06-01"), coin: "USDT", delta: 100 }, { t: at("2026-06-03", 1), coin: "USDT", delta: 1 }] }, days.slice(0, 3));
    expect(s.unexplained).toEqual([]);
    expect(s.balances["2026-06-03"].USDT).toBe(101);
  });
});

describe("the trading part and the sum", () => {
  it("takes the savings off today's holdings, and adds two histories", () => {
    expect(tradingPart({ USDT: 40, BTC: 1 }, { USDT: 0.3 }, { USDT: 50 })).toEqual({ USDT: 0, BTC: 1 });
    expect(addBalances({ d: { USDT: 1 } }, { d: { USDT: 2, BTC: 1 } })).toEqual({ d: { USDT: 3, BTC: 1 } });
  });
});
