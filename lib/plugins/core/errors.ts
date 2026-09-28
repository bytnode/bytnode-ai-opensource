/* ---------------------------------------------------------------------------
   The HTTP status of a view action's failure (`/api/plugins/<id>/<action>`).

   Every handler refuses bad input with a plain `throw new Error("…")`
   whose message is written for the user ("Give the group a name."): that
   is the caller's mistake, a 400 — not a server fault. What names
   something that does not exist (an unknown id) is a 404. A 500 stays for
   what really broke: a TypeError, a RangeError, a system error (it carries
   an errno `code`), a plugin written by an agent that crashed. A store
   another process holds is a 503: try again.

   Pure, tested.
--------------------------------------------------------------------------- */

/** An action's way to say "no such thing" explicitly. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The refusals of the shipped plugins that name an unknown id — their
    pure functions return these texts. */
const UNKNOWN = /^(No such group\.|No DCA plan "|No scheduled task |No paper portfolio "|This alert cannot be paused: it is done or gone\.|This entry is no longer in the calendar\.)/;

/** `lib/plugins/core/store.ts` `withLock`. */
const BUSY = /^Busy: .* is locked by another process\.$/;

export function actionStatus(e: unknown): number {
  if (e instanceof NotFoundError) return 404;
  if (!(e instanceof Error)) return 400;
  if ((e as NodeJS.ErrnoException).code !== undefined) return 500;
  if (e.name === "WorkspaceError") return 400;
  if (Object.getPrototypeOf(e) !== Error.prototype) return 500;
  if (BUSY.test(e.message)) return 503;
  return UNKNOWN.test(e.message) ? 404 : 400;
}
