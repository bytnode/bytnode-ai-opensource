/* ---------------------------------------------------------------------------
   What a plugin installs belongs to it.

   Every tool, job, subscription or timer a plugin registers is recorded in
   its scope with the way to undo it. Stopping the plugin disposes the
   scope: everything goes, in reverse order, even if one undo fails — no
   leftover, no leak. Something registered after the scope is closed is
   undone at once (a setup that finishes after being cancelled).
--------------------------------------------------------------------------- */

export type Disposer = () => void | Promise<void>;

export class Scope {
  private disposers: Disposer[] = [];
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  add(dispose: Disposer): void {
    if (this.closed) {
      void Promise.resolve()
        .then(dispose)
        .catch(() => {});
      return;
    }
    this.disposers.push(dispose);
  }

  /** Undoes everything; returns the errors met along the way. */
  async dispose(): Promise<string[]> {
    this.closed = true;
    const errors: string[] = [];
    for (const dispose of this.disposers.reverse()) {
      try {
        await dispose();
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    this.disposers = [];
    return errors;
  }
}
