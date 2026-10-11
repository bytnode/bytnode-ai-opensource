import type { Message } from "@/lib/domain/types";
import { currentMessages } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   Compacting a conversation.

   A long conversation is sent back whole at every turn: it becomes
   expensive, slow, and eventually exceeds the model's window. `/compact`
   asks the agent for a summary of what was done and decided, then the
   thread is replaced by that summary — the conversation goes on, with its
   memory, without its weight.

   The same mechanism serves both engines: an agent on OpenRouter sees the
   summary at the head of its history; a subscription agent starts over on
   a fresh session seeded with that summary.

   Pure: no disk, no network.
--------------------------------------------------------------------------- */

/** `/compact`, alone or followed by instructions. Returns `null` if the
    text is not the command — a message that mentions it is not the command. */
export function isCompactCommand(text: string): { instructions: string } | null {
  const m = text.trim().match(/^\/compact(?:\s+([\s\S]*))?$/i);
  return m ? { instructions: (m[1] ?? "").trim() } : null;
}

/** Who triggered the compaction: the user (`/compact`), the meter being
    full at the end of a turn (`auto`), or a « context exceeded » error from
    the provider (`overflow`). */
export type CompactedBy = "user" | "auto" | "overflow";

/** The boundary's line in the thread, in the interface's language. */
export function compactLabel(m: Pick<Message, "compactedBy">): string {
  const t = currentMessages().chat;
  switch (m.compactedBy) {
    case "auto":
      return t.compactedAuto;
    case "overflow":
      return t.compactedOverflow;
    default:
      return t.compacted;
  }
}

/* ⚠️ « CONTEXT EXCEEDED » IS NOT A TRANSIENT ERROR. Retrying the same
   request would fail the same way; the only way out is to compact the
   thread and replay. Every provider says it its own way (OpenRouter,
   Anthropic, OpenAI…): we recognise the family of wordings, on a 400/413
   or with no status. */
const OVERFLOW_TEXT = /context.length|context.limit|too long|too many tokens|maximum.*tokens|tokens.*maximum|exceed.*context/i;

export function isContextOverflow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; status?: unknown; message?: unknown };
  if (e.name === "AbortError") return false;
  if (typeof e.status === "number" && e.status !== 400 && e.status !== 413) return false;
  return typeof e.message === "string" && OVERFLOW_TEXT.test(e.message);
}

/** What we ask the agent. It knows the thread: no need to hand it back,
    it is enough to say what to keep of it. */
export function buildCompactRequest(instructions: string): string {
  const lines = [
    "Summarise our conversation so far. This summary will REPLACE the thread: anything not in it will be lost for what follows.",
    "",
    "Structure it like this, keeping exact figures and file paths:",
    "1. **Request** — what the user is trying to obtain, in their own terms.",
    "2. **Done** — what was measured, computed, written or tested, with the values and the files produced (full paths).",
    "3. **Decisions** — what was settled, and why; the preferences the user expressed.",
    "4. **In progress** — what is not finished, and the immediate next step.",
    "5. **Not to redo** — the approaches tried without success, so as not to come back to them.",
    "",
    "Be dense and factual: no pleasantries, no commentary on the summary itself. Do not summarise this summary: write it.",
  ];
  if (instructions) lines.push("", `User's instruction for this summary: ${instructions}`);
  return lines.join("\n");
}

const MAX_TRANSCRIPT = 12_000;

/** The thread as text, for an agent that no longer has it (session lost,
    or a new session after compaction). Bounded: the latest exchanges. */
export function transcriptOf(messages: Message[], max = MAX_TRANSCRIPT): string {
  const lines = messages
    .filter((m) => m.content.trim() && !m.compacting)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content.trim()}`);
  const out = lines.join("\n\n");
  return out.length > max ? `[…]\n${out.slice(-max)}` : out;
}

/** The message that replaces the thread. It carries `compaction`: the
    thread shows it as a summary, and `history.ts` replays it as a context
    reminder. */
export function compactionMessage(summary: string, id: string, createdAt: number, compactedBy: CompactedBy = "user"): Message {
  return { id, role: "assistant", content: summary, createdAt, compaction: true, compactedBy, steps: [{ type: "text", text: summary }] };
}
