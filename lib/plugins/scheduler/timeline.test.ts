import { describe, expect, it } from "vitest";
import { frequencyText, relative, timeline } from "./timeline";

/* Local time, like the scheduler: 2026-09-24 10:00. */
const now = new Date(2026, 8, 24, 10, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();

describe("timeline", () => {
  it("frequent work is a band, the rest are marks in the window", () => {
    const { marks, bands } = timeline(
      [
        { id: "alerts", title: "Alerts", every: "every 1 minute", kind: "job" },
        { id: "brief", title: "Morning brief", every: "daily at 08:00", kind: "task" },
        { id: "snap", title: "Snapshot", every: "every 6 hours", kind: "job", nextRun: new Date(at(24, 12)).toISOString() },
        { id: "off", title: "Paused", every: "daily at 11:00", kind: "task", paused: true },
        { id: "bad", title: "Broken", every: "whenever", kind: "task" },
      ],
      now,
    );
    expect(bands).toEqual([{ id: "alerts", title: "Alerts", kind: "job", every: "every minute" }]);
    expect(marks.map((m) => [m.id, m.at])).toEqual([
      ["snap", at(24, 12)],
      ["snap", at(24, 18)],
      ["snap", at(25, 0)],
      ["snap", at(25, 6)],
      ["brief", at(25, 8)],
    ]);
  });

  it("a next run already past starts from now", () => {
    const { marks } = timeline([{ id: "w", title: "Weekly", every: "every friday at 09:00", kind: "task", nextRun: new Date(at(20, 9)).toISOString() }], now, 24 * 3);
    expect(marks.map((m) => m.at)).toEqual([at(25, 9)]);
  });
});

describe("the words", () => {
  it("reads a frequency back", () => {
    expect(frequencyText("daily at 8:00")).toBe("Daily at 08:00");
    expect(frequencyText("every 240 minutes")).toBe("Every 4 hours");
    expect(frequencyText("whenever")).toBe("Whenever");
  });

  it("says a moment against now", () => {
    expect(relative(now + 20_000, now)).toBe("now");
    expect(relative(at(24, 10, 12), now)).toBe("in 12 min");
    expect(relative(at(24, 12, 5), now)).toBe("in 2 h 05");
    expect(relative(at(24, 18), now)).toBe("today 18:00");
    expect(relative(at(25, 8), now)).toBe("tomorrow 08:00");
    expect(relative(at(28, 9, 30), now)).toBe("Mon 09:30");
    expect(relative(at(24, 9, 55), now)).toBe("5 min ago");
    expect(relative(at(23, 8), now)).toBe("yesterday 08:00");
    expect(relative(at(12, 8), now)).toBe("12 Sept");
    expect(relative(undefined, now)).toBe("—");
  });
});
