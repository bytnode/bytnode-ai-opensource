import { describe, expect, test } from "vitest";
import os from "node:os";
import { HeadTail, describeRun, run, stripAnsi } from "./run";
import { OUTPUT_LIMIT, ok } from "../types";

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

/* A long output: the END is where the failing summary and the exit status
   are. Keeping only the head lost both, silently. */
describe("run: what is kept of a long output", () => {
  test("HeadTail keeps the start and the end and counts the cut", () => {
    const h = new HeadTail(10);
    h.push("abcdefgh");
    h.push("ijklmnopqrstuvwxyz");
    expect(h.toString()).toBe("abcde\n[… 16 characters cut …]\nvwxyz");
    const small = new HeadTail(100);
    small.push("short");
    expect(small.toString()).toBe("short");
  });

  /* `process.exitCode`, not `process.exit()`: on macOS/Linux stdout into a
     pipe is asynchronous and `exit()` drops what is still queued — the
     child itself lost its last lines (Windows pipes are synchronous). */
  test("the summary line and the exit status reach the model", async () => {
    const script = "for(let i=0;i<5000;i++)console.log('test ' + i + ' passed ' + 'x'.repeat(60)); console.log('SUMMARY: 3 FAILED, 4997 passed'); process.exitCode = 3;";
    const r = await run(process.execPath, ["-e", script], { cwd: os.tmpdir(), timeoutMs: 30_000 });
    const out = describeRun(r, "Bash");
    expect(out).toContain("SUMMARY: 3 FAILED");
    expect(out).toMatch(/characters cut/);
    expect(out.endsWith("]")).toBe(true);
    expect(out).toMatch(/\[Bash finished with code 3 in [\d.]+ s\]$/);
    /* And `ok()`'s own bound no longer cuts it. */
    expect(ok(out).output).toBe(out);
    expect(out.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
  });

  test("a signal already aborted launches nothing", async () => {
    const c = new AbortController();
    c.abort();
    const r = await run(process.execPath, ["-e", "setTimeout(()=>console.log('ran anyway'), 300)"], { cwd: os.tmpdir(), timeoutMs: 30_000, signal: c.signal });
    expect(r.aborted).toBe(true);
    expect(r.stdout).not.toContain("ran anyway");
  });

  test("terminal colour codes are stripped for the model", () => {
    const r = { code: 1, stdout: "out", stderr: "\u001b[31;1mWrite-Error: \u001b[31;1merr\u001b[0m", timedOut: false, aborted: false, matched: false, durationMs: 10 };
    expect(describeRun(r, "PowerShell")).toBe("out\n[stderr]\nWrite-Error: err\n[PowerShell finished with code 1 in 0.0 s]");
    expect(stripAnsi("\u001b]0;title\u0007plain")).toBe("plain");
  });
});
