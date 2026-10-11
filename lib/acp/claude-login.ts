import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { groupSpawnOptions, killTree, trackGroup } from "@/lib/server/process-groups";
import { cliLaunch, subscriptionEnv } from "./launch";

/* ---------------------------------------------------------------------------
   Signing in to Claude INSIDE the app (user request, 2026-10-07: « je dois
   copier le code du navigateur dans le terminal, pas dans un bloc de
   l'app »).

   `claude auth login` needs no terminal: it opens the browser, prints the
   sign-in address (« If the browser didn't open, visit: … »), and reads the
   code the browser page shows from its standard input — one line,
   `<code>#<state>` — or finishes on its own when the browser hands the code
   back through its local callback. So the server runs it in the
   background, keeps the address, and writes the code the user pastes into
   the app's sign-in block. It prints « Login successful. » and exits 0, or
   exits non-zero with the reason on stderr.

   One sign-in at a time, kept on `globalThis` (a hot reload must not lose
   the process it started). 10 minutes, then it is stopped.
--------------------------------------------------------------------------- */

const TIMEOUT_MS = 10 * 60_000;

export type ClaudeSignIn = {
  /** The address to open if the browser did not (null until printed). */
  url: string | null;
  /** Why it failed — the sign-in is over then, a new one starts on click. */
  error: string | null;
  /** A code was sent and is being checked. */
  checking: boolean;
};

type Pending = ClaudeSignIn & { child: ChildProcess | null; out: string; err: string; timer: ReturnType<typeof setTimeout> | null };

const slot = globalThis as typeof globalThis & { __bytnodeClaudeLogin?: Pending | null };

/** Escape sequences out (colours, OSC 8 hyperlinks: the CLI may wrap the
    address in one). Pure. */
export function plainText(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

/** The sign-in address the CLI printed, once it has. Pure. */
export function signInUrl(output: string): string | null {
  const m = plainText(output).match(/visit:\s*(https:\/\/\S+)/i);
  return m ? m[1] : null;
}

/** What the browser page shows: `<code>#<state>`, one line, no space —
    the CLI refuses anything else (« Invalid code »). Pure. */
export function isLoginCode(code: string): boolean {
  return /^[^\s#]+#[^\s#]+$/.test(code.trim());
}

/** The reason of a failed sign-in, from what the CLI wrote. Pure. */
export function failureOf(stderr: string, stdout: string, code: number | null): string {
  const lines = plainText(`${stderr}\n${stdout}`)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(Opening browser|If the browser didn't open|Paste code here)/i.test(l));
  return lines.slice(-2).join(" ") || `Claude's sign-in stopped (exit ${code ?? "?"}).`;
}

export function claudeSignIn(): ClaudeSignIn | null {
  const p = slot.__bytnodeClaudeLogin;
  return p ? { url: p.url, error: p.error, checking: p.checking } : null;
}

/** Starts a sign-in, or keeps the one running. `onDone(ok)` when it ends. */
export function startClaudeSignIn(onDone: (ok: boolean) => void): void {
  const running = slot.__bytnodeClaudeLogin;
  if (running?.child && running.child.exitCode === null && !running.error) return;
  const { command, args } = cliLaunch("claude");
  const child = spawn(command, [...args, "auth", "login"], { env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...groupSpawnOptions() });
  trackGroup(child);
  const p: Pending = { child, url: null, error: null, checking: false, out: "", err: "", timer: null };
  slot.__bytnodeClaudeLogin = p;
  child.stdout?.on("data", (d: Buffer) => {
    p.out += d.toString("utf8");
    p.url ??= signInUrl(p.out);
  });
  child.stderr?.on("data", (d: Buffer) => {
    p.err += d.toString("utf8");
    /* A code the CLI refused at once (malformed): it keeps waiting. */
    if (/Invalid code/i.test(d.toString("utf8"))) {
      p.checking = false;
      p.error = "This code was not accepted: copy the whole code the page shows, then try again.";
    }
  });
  child.on("error", (e) => {
    p.error = `Could not start Claude's sign-in: ${e.message}`;
    p.child = null;
    onDone(false);
  });
  child.on("exit", (code) => {
    if (p.timer) clearTimeout(p.timer);
    p.child = null;
    p.checking = false;
    if (code === 0) {
      if (slot.__bytnodeClaudeLogin === p) slot.__bytnodeClaudeLogin = null;
      onDone(true);
    } else {
      p.error ??= failureOf(p.err, p.out, code);
      onDone(false);
    }
  });
  p.timer = setTimeout(() => {
    p.error = "The sign-in timed out. Start it again.";
    killTree(child);
  }, TIMEOUT_MS);
}

/** Sends the code pasted in the app. */
export function sendClaudeCode(code: string): void {
  const p = slot.__bytnodeClaudeLogin;
  if (!p?.child || p.child.exitCode !== null) throw new Error("No Claude sign-in is waiting: click Sign in again.");
  if (!isLoginCode(code)) throw new Error("This does not look like the code: copy the whole code the page shows (it contains a #).");
  p.error = null;
  p.checking = true;
  p.child.stdin?.write(`${code.trim()}\n`);
}

/** Stops a sign-in and forgets it. */
export function cancelClaudeSignIn(): void {
  const p = slot.__bytnodeClaudeLogin;
  slot.__bytnodeClaudeLogin = null;
  if (p?.timer) clearTimeout(p.timer);
  if (p?.child && p.child.exitCode === null) killTree(p.child);
}
