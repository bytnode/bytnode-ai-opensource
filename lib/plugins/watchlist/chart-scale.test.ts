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
});
