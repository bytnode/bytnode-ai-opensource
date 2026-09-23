/* ---------------------------------------------------------------------------
   Plugins talk through events, not by calling each other.

   A plugin announces what happened (`watchlist:changed`, `paper:filled`);
   whoever cares listens. The emitter does not know its listeners, so
   removing one plugin breaks none of the others. A listener that throws
   is reported and the others still run.

   ⚠️ IN-PROCESS HINTS ONLY. A tool served to a subscription agent runs in
   another process (the MCP server): its events never reach the Next
   server. Listeners use events to act sooner, and always re-read the
   state from disk.
--------------------------------------------------------------------------- */

export type Listener = (payload: unknown) => void | Promise<void>;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private readonly report: (event: string, error: unknown) => void = () => {}) {}

  /** Subscribes; the returned function unsubscribes. */
  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        const r = listener(payload);
        if (r instanceof Promise) r.catch((e) => this.report(event, e));
      } catch (e) {
        this.report(event, e);
      }
    }
  }

  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
