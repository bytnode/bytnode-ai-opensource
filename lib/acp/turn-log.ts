/* ---------------------------------------------------------------------------
   The events of a subscription turn, kept on the server while it runs.

   ⚠️ A TURN NO LONGER DIES WITH ITS REQUEST. The browser's stream used to
   BE the turn: when the connection broke ("network error" — the user had
   only gone to another conversation or tab), the server read it as a Stop
   and cancelled the agent's work. Now the turn writes into this log, the
   request only READS it, and a broken read is picked up again where it
   stopped (`/api/acp/stream?from=N`). Only an explicit Stop
   (`/api/acp/cancel`) cancels — or nobody reading any more for
   `ORPHAN_MS` (the page was closed or reloaded): then the turn is
   cancelled as before, so no agent keeps working, or waits on a
   permission, for a page that no longer exists.

   One log per conversation (a conversation has one turn at a time); a
   finished log stays `KEEP_MS` so a late reader still gets the end.
--------------------------------------------------------------------------- */

export const ORPHAN_MS = 90_000;
export const KEEP_MS = 5 * 60_000;

export class TurnLog<E> {
  private readonly events: E[] = [];
  private wakers = new Set<() => void>();
  private readers = 0;
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  done = false;
  finishedAt: number | null = null;

  constructor(
    readonly turnId: string,
    private readonly onOrphan: () => void,
    private readonly orphanMs = ORPHAN_MS,
  ) {
    /* Nobody reads it yet: a request gone before its first read still
       ends as an orphan. */
    this.armOrphan();
  }

  get size(): number {
    return this.events.length;
  }

  push(e: E): void {
    if (this.done) return;
    this.events.push(e);
    this.wake();
  }

  finish(now = Date.now()): void {
    if (this.done) return;
    this.done = true;
    this.finishedAt = now;
    this.clearOrphan();
    this.wake();
  }

  /** The events from index `from`, then the new ones as they come, until
      the turn ends or `signal` aborts. While at least one reader follows,
      the turn is not an orphan. */
  async *follow(from: number, signal: AbortSignal): AsyncGenerator<E> {
    this.readers++;
    this.clearOrphan();
    let i = Math.max(0, from);
    try {
      for (;;) {
        while (i < this.events.length) yield this.events[i++];
        if (this.done || signal.aborted) return;
        await new Promise<void>((resolve) => {
          const wake = () => {
            this.wakers.delete(wake);
            signal.removeEventListener("abort", wake);
            resolve();
          };
          this.wakers.add(wake);
          signal.addEventListener("abort", wake, { once: true });
        });
      }
    } finally {
      this.readers--;
      if (this.readers === 0 && !this.done) this.armOrphan();
    }
  }

  private wake(): void {
    for (const w of [...this.wakers]) w();
  }

  private armOrphan(): void {
    this.clearOrphan();
    this.orphanTimer = setTimeout(() => {
      this.orphanTimer = null;
      if (this.readers === 0 && !this.done) this.onOrphan();
    }, this.orphanMs);
    this.orphanTimer.unref?.();
  }

  private clearOrphan(): void {
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.orphanTimer = null;
  }
}

/** The logs by conversation. A finished one is swept after `KEEP_MS`. */
export class TurnLogs<E> {
  private readonly logs = new Map<string, TurnLog<E>>();

  open(conversationId: string, turnId: string, onOrphan: () => void, orphanMs = ORPHAN_MS): TurnLog<E> {
    this.sweep();
    const log = new TurnLog<E>(turnId, onOrphan, orphanMs);
    this.logs.set(conversationId, log);
    return log;
  }

  /** The log of THIS turn — never a newer one of the same conversation. */
  get(conversationId: string, turnId: string): TurnLog<E> | null {
    this.sweep();
    const log = this.logs.get(conversationId);
    return log && log.turnId === turnId ? log : null;
  }

  sweep(now = Date.now()): void {
    for (const [id, log] of this.logs) if (log.finishedAt !== null && now - log.finishedAt > KEEP_MS) this.logs.delete(id);
  }
}
