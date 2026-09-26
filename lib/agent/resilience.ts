/* ---------------------------------------------------------------------------
   The loop's safety net: retry what should be retried, cut off what goes
   round in circles.

   Two distinct failures, two treatments.

   ⚠️ A TRANSIENT ERROR IS NOT AN ERROR. A 429, a 502, a dropped
   connection: the request produced nothing, retrying it is risk-free — and
   it is all that separates a lost turn from one that succeeds. A request
   error (invalid key, unknown model, credit exhausted), on the other hand,
   will reproduce identically: retrying only delays the error message.

   ⚠️ AN AGENT CAN GO ROUND IN CIRCLES. The same tool, the same arguments,
   the same failure, forty times — it costs money and time, and never
   succeeds. At the third identical call, we refuse and tell the agent,
   which has to change course.

   Pure: no network, no real time — tested.
--------------------------------------------------------------------------- */

/** The statuses worth a retry: overload, unavailability, timeout. */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524, 529]);

/** Network drops, as the runtimes name them. */
const TRANSIENT_TEXT =
  /failed to fetch|network|socket hang up|econnreset|econnrefused|etimedout|epipe|enotfound|terminated|stream closed|fetch failed|other side closed/i;

export function isTransient(error: unknown): boolean {
  /* A deliberate interruption (Stop button) is never retried. */
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (typeof error === "object" && error !== null) {
    const e = error as { name?: unknown; status?: unknown; message?: unknown };
    if (e.name === "AbortError") return false;
    if (typeof e.status === "number" && TRANSIENT_STATUS.has(e.status)) return true;
    if (typeof e.status === "number") return false;
    if (typeof e.message === "string" && TRANSIENT_TEXT.test(e.message)) return true;
  }
  return false;
}

export const MAX_ATTEMPTS = 3;

/** Wait before the retry: growing, bounded, with a bit of randomness so
    that everyone does not restart at the same time. */
export const MAX_BACKOFF = 8000;

export function backoffDelay(attempt: number): number {
  const base = Math.min(MAX_BACKOFF, 600 * 2 ** attempt);
  /* The bound applies AFTER the randomness: otherwise a high draw exceeds it. */
  return Math.min(MAX_BACKOFF, Math.round(base * (0.75 + Math.random() * 0.5)));
}

/* --- Going round in circles ---------------------------------------------- */

export type CallLike = { name: string; args: Record<string, unknown> };

/** A call's signature: the name and the arguments, regardless of key
    order. */
export function callSignature(call: CallLike): string {
  const args = Object.keys(call.args ?? {})
    .sort()
    .map((k) => `${k}=${JSON.stringify(call.args[k])}`)
    .join("&");
  return `${call.name}|${args}`;
}

export const MAX_IDENTICAL = 3;

export class RepetitionGuard {
  private counts = new Map<string, number>();

  /** Returns `null` if the call may go ahead, or the message to return to
      the agent in place of the result. */
  check(call: CallLike): string | null {
    const sig = callSignature(call);
    const n = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, n);
    if (n < MAX_IDENTICAL) return null;
    const resume = summarize(call);
    return (
      `You have just requested exactly the same call ${MAX_IDENTICAL} times: ${call.name}${resume ? ` — ${resume}` : ""}. ` +
      `It will not give a different result. Change approach: read the previous error, check your arguments, ` +
      `try another tool, or explain to the user what is blocking and what you need.`
    );
  }

  /** A call that succeeded: every counter starts again from zero. Not only
      its own — something happened between two identical calls (a file
      written, a plugin fixed with PluginWrite), so running PluginCheck or a
      test command again is progress, not a loop. What stays caught is the
      same call failing again and again with nothing succeeding between. */
  succeeded(call: CallLike): void {
    void call;
    this.counts.clear();
  }
}

/** Enough to recognise the call in the message, without copying it whole. */
function summarize(call: CallLike): string {
  const a = call.args ?? {};
  for (const k of ["command", "file_path", "pattern", "url", "data", "strategy", "name"]) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  return "";
}
