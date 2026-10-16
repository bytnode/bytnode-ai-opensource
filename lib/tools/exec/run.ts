import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { groupSpawnOptions, killTree, trackGroup } from "@/lib/server/process-groups";
import { OUTPUT_LIMIT, clipMiddle } from "../types";

/* ---------------------------------------------------------------------------
   Launch a process and collect its output.

   A single gateway for Bash, PowerShell, Grep and Monitor: the time limit,
   the abort, the line-by-line reading and the bound on the size of what is
   kept live here. On Windows, killing the process tree requires
   `taskkill` — `kill()` only touches the parent.
--------------------------------------------------------------------------- */

export type RunOptions = {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called for every complete line of stdout or stderr. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** When a line matches, the process is stopped and `matched` is true. */
  until?: RegExp;
  env?: Record<string, string | undefined>;
  maxBytes?: number;
};

export type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  matched: boolean;
  durationMs: number;
};

const DEFAULT_MAX = 200_000;
/* A "line" without a newline (a binary, a one-block JSON) must not grow
   without end in memory: beyond this, it is delivered as is and the buffer
   starts over. */
const MAX_LINE = 1_000_000;
/* ⚠️ A COMMAND IS DONE WHEN ITS PROCESS EXITS, NOT WHEN ITS PIPES CLOSE.
   `python server.py &` leaves a grandchild holding stdout: Node's `close`
   never comes, and the call used to hang forever — even past its time
   limit, since the kill skipped a process that had already exited. After
   the exit, what the grandchild still writes is read for this long; after
   a kill, the pipes are dropped after as long. */
const EXIT_GRACE_MS = 1500;

/** Keeps the start and the end of a stream within `max` characters, and
    counts what fell between. ⚠️ The END is what matters most: the failing
    test summary, the build error, the last lines of a log — keeping only
    the head dropped them without a word. */
export class HeadTail {
  private head = "";
  private tail = "";
  private cut = 0;
  constructor(private readonly max: number) {}
  push(text: string): void {
    const headMax = Math.floor(this.max / 2);
    if (this.head.length < headMax) {
      const take = text.slice(0, headMax - this.head.length);
      this.head += take;
      text = text.slice(take.length);
    }
    if (!text) return;
    this.tail += text;
    const tailMax = this.max - headMax;
    if (this.tail.length > tailMax) {
      this.cut += this.tail.length - tailMax;
      this.tail = this.tail.slice(this.tail.length - tailMax);
    }
  }
  toString(): string {
    return this.cut ? `${this.head}\n[… ${this.cut} characters cut …]\n${this.tail}` : this.head + this.tail;
  }
}

export function run(command: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    /* Stopped before it began (a Stop between the loop's check and here):
       nothing is launched — the listener below would never fire. */
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, aborted: true, matched: false, durationMs: 0 });
      return;
    }
    /* A process group of its own on macOS / Linux, so that stopping the
       command stops what it launched too (`process-groups.ts`). */
    const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
    /* Never the desktop's secret for its server (`lib/bytnode/app-pass.ts`). */
    delete env.BYTNODE_AI_MAIN_SECRET;
    const child = spawn(command, args, { cwd: opts.cwd, env, windowsHide: true, ...groupSpawnOptions(), stdio: ["ignore", "pipe", "pipe"] });
    trackGroup(child);
    const max = opts.maxBytes ?? DEFAULT_MAX;
    const stdout = new HeadTail(max);
    const stderr = new HeadTail(max);
    let timedOut = false;
    let aborted = false;
    let matched = false;
    let settled = false;

    let exitCode: number | null = null;
    let dropTimer: NodeJS.Timeout | undefined;
    /** Stop reading and settle, whoever still holds the pipes. */
    const dropAfter = (ms: number) => {
      if (dropTimer || settled) return;
      dropTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(exitCode);
      }, ms);
    };

    /* The whole group, even when the shell itself has exited (POSIX): what
       it put in the background is still in it. */
    const kill = () => {
      killTree(child);
      dropAfter(EXIT_GRACE_MS);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const lineReader = (stream: "stdout" | "stderr") => {
      let rest = "";
      /* A UTF-8 character cut between two chunks stays whole. */
      const decoder = new StringDecoder("utf8");
      return (chunk: Buffer) => {
        const text = decoder.write(chunk);
        (stream === "stdout" ? stdout : stderr).push(text);
        if (!opts.onLine && !opts.until) return;
        rest += text;
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() ?? "";
        if (rest.length > MAX_LINE) {
          lines.push(rest);
          rest = "";
        }
        for (const line of lines) {
          opts.onLine?.(line, stream);
          if (opts.until && !matched && opts.until.test(line)) {
            matched = true;
            kill();
          }
        }
      };
    };
    child.stdout?.on("data", lineReader("stdout"));
    child.stderr?.on("data", lineReader("stderr"));

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(dropTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString(), timedOut, aborted, matched, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      stderr.push(`\n${e.message}`);
      finish(null);
    });
    child.on("exit", (code) => {
      exitCode = code;
      dropAfter(EXIT_GRACE_MS);
    });
    child.on("close", (code) => finish(code ?? exitCode));
  });
}

/* Terminal colours and cursor moves: pwsh 7 colours its errors even into a
   pipe (`ESC[31;1mWrite-Error: …`). The model and the thread want text. */
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** What is returned to the model after a command: the output, then the
    state. ⚠️ The status line (exit code, time limit) must ALWAYS reach the
    model: the output is cut in the middle to leave room for it, rather than
    letting `ok()`'s bound cut it off the end. */
export function describeRun(r: RunResult, label: string): string {
  const parts: string[] = [];
  const out = stripAnsi(r.stdout);
  const err = stripAnsi(r.stderr);
  if (out.trim()) parts.push(out.trimEnd());
  if (err.trim()) parts.push(`[stderr]\n${err.trimEnd()}`);
  const status = r.aborted
    ? "interrupted"
    : r.timedOut
      ? `stopped: time limit exceeded`
      : r.matched
        ? "stopped: pattern matched"
        : r.code === 0
          ? "finished (code 0)"
          : `finished with code ${r.code}`;
  const line = `[${label} ${status} in ${(r.durationMs / 1000).toFixed(1)} s]`;
  const body = clipMiddle(parts.join("\n"), OUTPUT_LIMIT - line.length - 100);
  return body ? `${body}\n${line}` : line;
}
