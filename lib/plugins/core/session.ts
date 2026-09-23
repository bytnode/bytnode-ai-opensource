import type { Session } from "./contract";

/* ---------------------------------------------------------------------------
   The keys of the open app, in the server's memory only.

   The keys never touch the disk. The background (alerts, snapshots,
   scheduled tasks) needs them while nobody is sending a request, so the
   open tab pushes them (`POST /api/session`) when it loads, when the
   settings change and every minute. When no tab has spoken for `TTL_MS`,
   the session is dropped: the background runs only while the app is open
   in a tab.
--------------------------------------------------------------------------- */

export const TTL_MS = 150_000;

export class SessionHolder {
  private value: Session | null = null;
  private at = 0;

  set(session: Session, now = Date.now()): void {
    this.value = session;
    this.at = now;
  }

  get(now = Date.now()): Session | null {
    if (this.value && now - this.at > TTL_MS) this.value = null;
    return this.value;
  }
}
