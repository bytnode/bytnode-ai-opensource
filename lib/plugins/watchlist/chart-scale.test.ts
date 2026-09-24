import { describe, expect, it } from "vitest";
import { decimalsFor, niceTicks, timeLabel, timeStep, timeTicks } from "./chart-scale";

describe("niceTicks", () => {
  it("gives round levels inside the range", () => {
    expect(niceTicks(2601, 2718, 5)).toEqual({ step: 25, ticks: [2625, 2650, 2675, 2700] });
    expect(niceTicks(0.2611, 0.2689, 4).ticks).toEqual([0.262, 0.264, 0.266, 0.268]);
  });

  it("is empty for an empty range", () => {
    expect(niceTicks(5, 5, 4).ticks).toEqual([]);
    expect(niceTicks(1, 2, 0).ticks).toEqual([]);
  });
});

describe("decimalsFor", () => {
  it("follows the price's size", () => {
    expect(decimalsFor(112480.5)).toBe(1);
    expect(decimalsFor(2694.6)).toBe(1);
    expect(decimalsFor(23.518)).toBe(2);
    expect(decimalsFor(0.26431)).toBe(4);
    expect(decimalsFor(0.0000123)).toBe(8);
  });

  it("shows the axis step when it is finer", () => {
    expect(decimalsFor(2694.6, 0.5)).toBe(1);
    expect(decimalsFor(23.5, 0.005)).toBe(3);
  });
});

describe("time axis", () => {
  it("keeps labels apart", () => {
    // 1 h bars, 8 px wide: 1 px = 7.5 min, 90 px ≥ 11.25 h → 12 h
    expect(timeStep(3_600_000, 8, 90)).toBe(12 * 3_600_000);
    expect(timeStep(3_600_000, 60, 90)).toBe(2 * 3_600_000);
  });

  it("puts ticks on the step, and labels midnight with the date", () => {
    const from = new Date(2026, 8, 23, 7, 10).getTime();
    const to = new Date(2026, 8, 24, 1, 0).getTime();
    const ticks = timeTicks(from, to, 6 * 3_600_000);
    expect(ticks.map((t) => new Date(t).getHours())).toEqual([12, 18, 0]);
    expect(timeLabel(ticks[0])).toBe("12:00");
    expect(timeLabel(ticks[2])).toBe("24 Sept");
  });

  it("walks the calendar for days and months, across a change of hour", () => {
    const from = new Date(2025, 9, 10, 12).getTime();
    const to = new Date(2026, 3, 10).getTime();
    const months = timeTicks(from, to, 30 * 86_400_000);
    expect(months.map((t) => [new Date(t).getMonth(), new Date(t).getDate(), new Date(t).getHours()])).toEqual([
      [10, 1, 0],
      [11, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
      [2, 1, 0],
      [3, 1, 0],
    ]);
    const days = timeTicks(new Date(2025, 9, 24, 6).getTime(), new Date(2025, 10, 3).getTime(), 2 * 86_400_000);
    expect(days.every((t) => new Date(t).getHours() === 0)).toBe(true);
    expect(days.map((t) => new Date(t).getDate())).toEqual([25, 27, 29, 31, 2]);
    expect(timeLabel(months[0])).toBe("Nov");
  });
});
