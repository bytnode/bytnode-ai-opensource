import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { describeRun, run, stripAnsi } from "./run";
import { UTF8_ENV, bashArgs, clampTimeout, findBash } from "./shells";
import { workspaceRefusal } from "./guard";
import { resolvePublic } from "../web/public-fetch";

/* ---------------------------------------------------------------------------
   Monitor: watch a command, or a WebSocket, line by line.

   Every line is sent to the screen the moment it comes out (`tool_line`
   event), and the tool hands control back to the model when an `until`
   pattern appears, when the process ends, or when the time limit is
   reached. It is a BOUNDED watch: nothing survives the turn.
--------------------------------------------------------------------------- */

type Args = { command?: string; url?: string; until?: string; timeout?: number; description?: string };

const DEFAULT_TIMEOUT = 60_000;
const HEAD_LINES = 100;
const TAIL_LINES = 400;

/** The lines the model gets back: the first ones and the LATEST ones, with
    how many fell between. ⚠️ Monitor waits for a build, a server, a stream:
    what matters is the end — the matching line, the last state. Keeping
    only the first 500 lines dropped the very line that ended the watch.
    After a match nothing more is kept: the watch is over, and the matching
    line stays the last one. */
export class LineKeeper {
  readonly head: string[] = [];
  private tail: string[] = [];
  private dropped = 0;
  private closed = false;
  count = 0;
  constructor(private readonly headMax = HEAD_LINES, private readonly tailMax = TAIL_LINES) {}
  push(line: string): void {
    if (this.closed) return;
    this.count++;
    if (this.head.length < this.headMax) {
      this.head.push(line);
      return;
    }
    this.tail.push(line);
    if (this.tail.length > this.tailMax) {
      this.tail.shift();
      this.dropped++;
    }
  }
  /** Keep nothing after this line. */
  close(): void {
    this.closed = true;
  }
  text(): string {
    const cut = this.dropped ? [`[… ${this.dropped} line${this.dropped > 1 ? "s" : ""} not kept …]`] : [];
    return [...this.head, ...cut, ...this.tail].join("\n");
  }
}

export const monitorTool: Tool<Args> = {
  name: "Monitor",
  policy: { gated: true, subagent: true },
  description:
    "Watches a command (`command`) or a WebSocket (`url` ws:// or wss://, public addresses only) and returns the first and the latest lines or messages received. Stops when a line matches `until` (regular expression), when the process ends, or after `timeout` ms (default 60000, max 600000). Useful to wait for a server to be ready, for a build to finish, or to observe a stream.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to watch (bash)." },
      url: { type: "string", description: "WebSocket address to listen to (instead of command)." },
      until: { type: "string", description: "Pattern that ends the watch." },
      timeout: { type: "integer", description: "Time limit in milliseconds." },
      description: { type: "string", description: "What is being waited for, in a few words." },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const timeoutMs = clampTimeout(args.timeout, DEFAULT_TIMEOUT);
    let until: RegExp | undefined;
    if (args.until) {
      try {
        until = new RegExp(args.until);
      } catch (e) {
        return fail(`Invalid until pattern: ${errorText(e)}`);
      }
    }
    const kept = new LineKeeper();
    const push = (raw: string) => {
      const line = stripAnsi(raw);
      kept.push(line);
      if (until?.test(line)) kept.close();
      ctx.emit({ type: "tool_line", id: ctx.callId, line });
    };

    if (args.url) {
      /* Same rule as WebFetch: never this machine nor its network (the
         app's own server is on 127.0.0.1), and a WebSocket scheme only. */
      let target: URL;
      try {
        target = new URL(args.url);
        await resolvePublic(target, { websocket: true });
      } catch (e) {
        return fail(`Could not watch ${args.url}: ${errorText(e)}`);
      }
      return watchSocket(target.toString(), until, timeoutMs, ctx.signal, push, kept);
    }
    if (!args.command) return fail("Give `command` or `url`.");
    if (ctx.scope === "workspace") {
      const refused = workspaceRefusal(args.command, ctx.workspace);
      if (refused) return fail(refused);
    }

    const bash = findBash();
    if (!bash) return fail("No bash found on this machine.");
    try {
      const r = await run(bash, bashArgs(args.command), {
        cwd: ctx.workspace,
        timeoutMs,
        signal: ctx.signal,
        until,
        onLine: push,
        env: { MSYS_NO_PATHCONV: "1", ...UTF8_ENV },
      });
      /* A command that fails is a failure, like Bash's; stopping on the
         pattern or at the time limit is how a watch normally ends. */
      const failed = !r.matched && !r.timedOut && !r.aborted && r.code !== 0;
      return (failed ? fail : ok)(describeRun({ ...r, stdout: kept.text(), stderr: "" }, "Monitor"));
    } catch (e) {
      return fail(`Monitor failed: ${errorText(e)}`);
    }
  },
};

function watchSocket(url: string, until: RegExp | undefined, timeoutMs: number, signal: AbortSignal, push: (line: string) => void, kept: LineKeeper) {
  return new Promise<ReturnType<typeof ok>>((resolve) => {
    const started = Date.now();
    /* Node's own WebSocket arrived in Node 22: on Node 20 the name does
       not exist and the call failed with a ReferenceError. */
    if (typeof WebSocket === "undefined") {
      resolve(fail(`Watching a WebSocket needs Node.js 22 or newer (this is ${process.versions.node}). Poll the HTTP endpoint with \`command\` instead, or update Node.`));
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve(fail(`Could not connect to ${url}: ${errorText(e)}`));
      return;
    }
    let settled = false;
    const finish = (status: string, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      const text = kept.text();
      const body = `${text ? `${text}\n` : ""}[WebSocket ${url} ${status} in ${((Date.now() - started) / 1000).toFixed(1)} s, ${kept.count} message${kept.count > 1 ? "s" : ""}]`;
      resolve(failed ? fail(body) : ok(body));
    };
    const timer = setTimeout(() => finish("stopped: time limit exceeded"), timeoutMs);
    const onAbort = () => finish("interrupted");
    signal.addEventListener("abort", onAbort, { once: true });
    ws.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : "[binary message]";
      push(text);
      if (until?.test(text)) finish("stopped: pattern matched");
    };
    /* The browser-style error event carries no reason: say at least that
       the connection could not be made or broke. */
    ws.onerror = (ev) => finish(`in error (${(ev as ErrorEvent).message || "connection refused or broken"})`, true);
    ws.onclose = () => finish("closed by the server");
  });
}
