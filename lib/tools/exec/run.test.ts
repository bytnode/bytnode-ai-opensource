import { describe, expect, test } from "vitest";
import { run } from "./run";

/* The line reader must not keep a stream without newlines in memory:
   beyond a bound, the line is delivered as is. */
describe("run: lines", () => {
  test("a very long line without an end is delivered in bounded pieces", async () => {
    const lines: string[] = [];
    const r = await run(process.execPath, ["-e", "process.stdout.write('x'.repeat(2_500_000))"], {
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: (l) => lines.push(l),
      maxBytes: 100,
    });
    expect(r.code).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    /* The bound, plus at most one chunk of the stream. */
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(1_500_000);
    /* And the kept output stays bounded by maxBytes (give or take a chunk). */
    expect(r.stdout.length).toBeLessThan(2_500_000);
  });
});
