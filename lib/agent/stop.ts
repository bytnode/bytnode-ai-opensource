import type { Message } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   A turn that did not end the way it started: stopped by the user, or cut
   by a recovery that failed.

   ⚠️ A STOPPED REPLY CARRIES `error: STOPPED`. It keeps what it wrote, and
   the thread must say it was stopped — otherwise it reads, later, as a
   complete answer that ends mid-sentence. Carried in `error` on purpose:
   the thread's Retry already RESUMES a reply that has content
   (`use-chat.ts` `retry`), which is exactly "Continue" here; the thread
   shows this value as a quiet mark, never as an alert.
--------------------------------------------------------------------------- */

export const STOPPED = "Stopped.";

export const isStopped = (m: Pick<Message, "error">) => m.error === STOPPED;

/** The provider refused the context, the user's message was taken out of
    the thread to compact it, and the compaction failed (or was stopped):
    the message comes BACK, with a reply that says why — Retry sends it
    again. Without this, the user's new message simply vanished. The
    compaction's status line never survives. */
export function restoreAfterFailedRecovery(messages: Message[], taken: Message[] | undefined, why: string): Message[] {
  const thread = messages.filter((m) => !m.compacting);
  if (!taken || taken.length === 0) return thread;
  const [question, reply] = taken;
  return [...thread, question, ...(reply ? [{ ...reply, error: why }] : [])];
}
