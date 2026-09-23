import { describe, expect, it } from "vitest";
import { describeFrequency, isFrequency, missedSince, nextRun, parseFrequency, type Frequency } from "./frequency";

const f = (text: string) => parseFrequency(text) as Frequency;
/* Local times, as the scheduler reads them. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("parseFrequency", () => {
  it("reads intervals, days and weekdays", () => {
    expect(f("every 15 minutes")).toEqual({ kind: "interval", minutes: 15 });
    expect(f("Every  2 hours")).toEqual({ kind: "interval", minutes: 120 });
    expect(f("every hour")).toEqual({ kind: "interval", minutes: 60 });
    expect(f("every 3 days")).toEqual({ kind: "interval", minutes: 4320 });
    expect(f("daily at 08:00")).toEqual({ kind: "daily", hour: 8, minute: 0 });
    expect(f("every day at 7:05")).toEqual({ kind: "daily", hour: 7, minute: 5 });
    expect(f("every monday at 09:30")).toEqual({ kind: "weekly", weekday: 1, hour: 9, minute: 30 });
  });

  it("refuses what it cannot read, with the expected forms", () => {
    expect(parseFrequency("0 8 * * *")).toMatchObject({ error: expect.stringMatching(/every 15 minutes/) });
    expect(parseFrequency("daily at 25:00")).toMatchObject({ error: expect.stringMatching(/Invalid time/) });
    expect(parseFrequency("every 0 minutes")).toMatchObject({ error: expect.stringMatching(/out of range/) });
    expect(isFrequency("every funday at 10:00")).toBe(false);
  });

  it("says it back", () => {
    for (const text of ["every 15 minutes", "every hour", "every 2 hours", "every day", "daily at 08:00", "every friday at 16:45"]) {
      expect(describeFrequency(f(text))).toBe(text);
    }
  });
});

describe("nextRun", () => {
  it("an interval counts from the previous run", () => {
    expect(nextRun(f("every 15 minutes"), at(2026, 9, 23, 10, 0))).toBe(at(2026, 9, 23, 10, 15));
  });

  it("a time of day: today if still ahead, otherwise tomorrow", () => {
    expect(nextRun(f("daily at 08:00"), at(2026, 9, 23, 7, 59))).toBe(at(2026, 9, 23, 8, 0));
    expect(nextRun(f("daily at 08:00"), at(2026, 9, 23, 8, 0))).toBe(at(2026, 9, 24, 8, 0));
  });

  it("a weekday: the next one, a week later once passed", () => {
    /* 2026-09-23 is a Wednesday. */
    expect(nextRun(f("every friday at 16:00"), at(2026, 9, 23, 12, 0))).toBe(at(2026, 9, 25, 16, 0));
    expect(nextRun(f("every wednesday at 09:00"), at(2026, 9, 23, 12, 0))).toBe(at(2026, 9, 30, 9, 0));
  });

  it("knows a run was missed while the app was closed", () => {
    expect(missedSince(f("daily at 08:00"), at(2026, 9, 22, 8, 0), at(2026, 9, 23, 9, 0))).toBe(true);
    expect(missedSince(f("daily at 08:00"), at(2026, 9, 23, 8, 0), at(2026, 9, 23, 9, 0))).toBe(false);
    expect(missedSince(f("every 2 hours"), at(2026, 9, 23, 6, 0), at(2026, 9, 23, 9, 0))).toBe(true);
  });
});
