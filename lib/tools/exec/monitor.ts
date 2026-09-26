import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { describeRun, run } from "./run";
import { UTF8_ENV, bashArgs, findBash } from "./shells";
import { findOutsideReferences, outsideMessage } from "./guard";

/* ---------------------------------------------------------------------------
   Monitor: watch a command, or a WebSocket, line by line.

   Every line is sent to the screen the moment it comes out (`tool_line`
   event), and the tool hands control back to the model when an `until`
   pattern appears, when the process ends, or when the time limit is
   reached. It is a BOUNDED watch: nothing survives the turn.
--------------------------------------------------------------------------- */

type Args = { command?: string; url?: string; until?: string; timeout?: number; description?: string };

const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 600_000;
const MAX_LINES = 500;

export const monitorTool: Tool<Args> = {
  name: "Monitor",
  policy: { gated: true, subagent: true },
  description:
    "Watches a command (`command`) or a WebSocket (`url` ws:// or wss://) and returns every line or message received. Stops when a line matches `until` (regular expression), when the process ends, or after `timeout` ms (default 60000, max 600000). Useful to wait for a server to be ready, for a build to finish, or to observe a stream.",
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
    const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(1_000, args.timeout ?? DEFAULT_TIMEOUT));
    let until: RegExp | undefined;
    if (args.until) {
      try {
        until = new RegExp(args.until);
      } catch (e) {
        return fail(`Invalid until pattern: ${errorText(e)}`);
      }
    }
    const lines: string[] = [];
    const push = (line: string) => {
      if (lines.length < MAX_LINES) lines.push(line);
      ctx.emit({ type: "tool_line", id: ctx.callId, line });
    };

    if (args.url) return watchSocket(args.url, until, timeoutMs, ctx.signal, push, lines);
    if (!args.command) return fail("Give `command` or `url`.");
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
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
      return ok(describeRun({ ...r, stdout: lines.join("\n"), stderr: "" }, "Monitor"));
    } catch (e) {
      return fail(`Monitor failed: ${errorText(e)}`);
    }
  },
};

function watchSocket(
  url: string,
  until: RegExp | undefined,
  timeoutMs: number,
  signal: AbortSignal,
  push: (line: string) => void,
  lines: string[],
) {
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
      const body = `${lines.join("\n")}\n[WebSocket ${url} ${status} in ${((Date.now() - started) / 1000).toFixed(1)} s, ${lines.length} message${lines.length > 1 ? "s" : ""}]`;
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
    ws.onerror = () => finish("in error", true);
    ws.onclose = () => finish("closed by the server");
  });
}
