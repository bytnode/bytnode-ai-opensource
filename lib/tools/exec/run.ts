import { spawn } from "node:child_process";

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

export function run(command: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const max = opts.maxBytes ?? DEFAULT_MAX;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let matched = false;
    let settled = false;

    const kill = () => {
      if (child.exitCode !== null || child.killed) return;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      } else {
        child.kill("SIGKILL");
      }
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
      return (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stream === "stdout") stdout = stdout.length < max ? stdout + text : stdout;
        else stderr = stderr.length < max ? stderr + text : stderr;
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
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted, matched, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      stderr += `\n${e.message}`;
      finish(null);
    });
    child.on("close", finish);
  });
}

/** What is returned to the model after a command: the output, then the state. */
export function describeRun(r: RunResult, label: string): string {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(r.stdout.trimEnd());
  if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  const status = r.aborted
    ? "interrupted"
    : r.timedOut
      ? `stopped: time limit exceeded`
      : r.matched
        ? "stopped: pattern matched"
        : r.code === 0
          ? "finished (code 0)"
          : `finished with code ${r.code}`;
  parts.push(`[${label} ${status} in ${(r.durationMs / 1000).toFixed(1)} s]`);
  return parts.join("\n");
}
