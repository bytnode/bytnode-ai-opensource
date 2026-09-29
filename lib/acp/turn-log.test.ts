import { afterEach, describe, expect, it, vi } from "vitest";
import { KEEP_MS, TurnLog, TurnLogs } from "./turn-log";

async function collect<E>(it: AsyncGenerator<E>): Promise<E[]> {
  const out: E[] = [];
  for await (const e of it) out.push(e);
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TurnLog", () => {
  it("replays from an index, then follows until the turn ends", async () => {
    const log = new TurnLog<number>("t", () => {});
    log.push(1);
    log.push(2);
    const reading = collect(log.follow(1, new AbortController().signal));
    log.push(3);
    log.finish();
    expect(await reading).toEqual([2, 3]);
  });

  it("a broken reading stops the reader, never the turn", async () => {
    const log = new TurnLog<number>("t", () => {});
    const gone = new AbortController();
    const first = collect(log.follow(0, gone.signal));
    log.push(1);
    await Promise.resolve();
    gone.abort();
    await first;
    log.push(2);
    log.finish();
    expect(await collect(log.follow(1, new AbortController().signal))).toEqual([2]);
  });

  it("cancels an orphan only when nobody reads for the whole delay", async () => {
    vi.useFakeTimers();
    const orphan = vi.fn();
    const log = new TurnLog<number>("t", orphan, 1000);
    const gone = new AbortController();
    const reading = collect(log.follow(0, gone.signal));
    vi.advanceTimersByTime(5000);
    expect(orphan).not.toHaveBeenCalled();
    gone.abort();
    await reading;
    vi.advanceTimersByTime(500);
    /* Read again in time: not an orphan. */
    const back = new AbortController();
    const again = collect(log.follow(0, back.signal));
    vi.advanceTimersByTime(5000);
    expect(orphan).not.toHaveBeenCalled();
    back.abort();
    await again;
    vi.advanceTimersByTime(1000);
    expect(orphan).toHaveBeenCalledTimes(1);
  });

  it("a finished turn is never an orphan", () => {
    vi.useFakeTimers();
    const orphan = vi.fn();
    const log = new TurnLog<number>("t", orphan, 1000);
    log.finish();
    vi.advanceTimersByTime(5000);
    expect(orphan).not.toHaveBeenCalled();
  });
});

describe("TurnLogs", () => {
  it("hands back only the asked turn, and forgets finished ones later", () => {
    const logs = new TurnLogs<number>();
    const log = logs.open("c", "t1", () => {}, 60_000);
    expect(logs.get("c", "t1")).toBe(log);
    expect(logs.get("c", "t2")).toBeNull();
    const now = Date.now();
    log.finish(now);
    expect(logs.get("c", "t1")).toBe(log);
    logs.sweep(now + KEEP_MS + 1);
    expect(logs.get("c", "t1")).toBeNull();
  });
});
