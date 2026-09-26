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

/* A command is done when its process exits: a grandchild left in the
   background with the pipes (`server &`) used to hang the call forever. */
describe("run: the end of a command", () => {
  test("a background grandchild holding stdout does not keep the call waiting", async () => {
    const script = [
      "const { spawn } = require('node:child_process');",
      "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit' });",
      "c.unref();",
      "console.log('started');",
      "process.exit(0);",
    ].join(" ");
    const started = Date.now();
    const r = await run(process.execPath, ["-e", script], { cwd: process.cwd(), timeoutMs: 30_000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("started");
    expect(Date.now() - started).toBeLessThan(6000);
  }, 20_000);

  test("a UTF-8 character split between two chunks stays whole", async () => {
    const script = "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9, 0x0a])), 100);";
    const lines: string[] = [];
    const r = await run(process.execPath, ["-e", script], { cwd: process.cwd(), timeoutMs: 10_000, onLine: (l) => lines.push(l) });
    expect(r.stdout).toBe("é\n");
    expect(lines[0]).toBe("é");
  });
});
