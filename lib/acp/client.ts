import { transportHeaders, type Transport } from "@/lib/tools/transport";
import { currentMessages } from "@/lib/i18n/store";
import type { AcpAgentId } from "./agents";
import type { WireEvent } from "./wire";

/* ---------------------------------------------------------------------------
   What the browser sees of a subscription turn.

   A turn = one request that stays open and narrates (NDJSON). Permission
   requests arrive in this stream and are answered through another request.

   ⚠️ THE STREAM IS NOT THE TURN. The server runs the turn on its own and
   keeps its events (`turn-log.ts`): a stream that breaks ("network error"
   — the user was only in another conversation or tab) is read again from
   the last event applied (`/api/acp/stream`), and the agent never knew.
   Stop is said explicitly (`/api/acp/cancel`).
--------------------------------------------------------------------------- */

export type AcpTurnInput = {
  conversationId: string;
  agent: AcpAgentId;
  agentId: string;
  workspace: string;
  profession: string;
  system: string;
  text: string;
  modelId: string | null;
  effort: string | null;
  mode: string | null;
  permissionMode: "ask" | "skip";
  sessionId: string | null;
  firstTurn: boolean;
  images?: string[];
  history?: string;
  /** The BytNode key, the agent's exchange accounts and plugins — sent as
      headers. The OpenRouter key is not needed: the agent has its own
      subscription. */
  transport: Transport;
};

export class AcpError extends Error {}

/** How long a broken stream is read again before the turn is given up. */
const RESUME_TRIES = 8;

export async function runAcpTurn(input: AcpTurnInput, onEvent: (e: WireEvent) => void, signal: AbortSignal): Promise<void> {
  const { transport, ...body } = input;
  const turnId = crypto.randomUUID();
  /* Stop: the server no longer reads a closed stream as one. */
  const onAbort = () => void cancelAcpTurn(input.conversationId);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch("/api/acp/prompt", {
      method: "POST",
      headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
      body: JSON.stringify({ ...body, turnId }),
      signal,
    });
    if (!res.ok || !res.body) throw new AcpError(await errorOf(res));
    /* The events applied so far: where a new reading starts. */
    let applied = 0;
    const count = (e: WireEvent | null) => {
      applied++;
      if (e) onEvent(e);
    };
    let reading: Response = res;
    for (let tries = 0; ; ) {
      try {
        await readEvents(reading, count);
        return;
      } catch (e) {
        if (signal.aborted || e instanceof AcpError || tries >= RESUME_TRIES) throw e;
        /* The connection broke, the turn did not: read it again. */
        let again: Response | null = null;
        while (!again && tries < RESUME_TRIES) {
          await wait(Math.min(4000, 300 * 2 ** tries++), signal);
          if (signal.aborted) throw e;
          const r = await fetch(`/api/acp/stream?${new URLSearchParams({ conversationId: input.conversationId, turnId, from: String(applied) })}`, { signal }).catch(() => null);
          if (r?.status === 404) throw e;
          if (r?.ok && r.body) again = r;
        }
        if (!again) throw e;
        reading = again;
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** One reading of the turn's NDJSON: every line counts as one event (an
    unreadable one too — the server's index must stay aligned). */
async function readEvents(res: Response, apply: (e: WireEvent | null) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: WireEvent | null = null;
      try {
        event = JSON.parse(line) as WireEvent;
      } catch {
        /* counted, not applied */
      }
      if (event?.type === "error") throw new AcpError(event.message);
      apply(event);
    }
  }
}

async function errorOf(res: Response): Promise<string> {
  let message = currentMessages().chat.errors.serverAnswered(res.status);
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    if (json.error?.message) message = json.error.message;
  } catch {
    /* no JSON */
  }
  return message;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export async function cancelAcpTurn(conversationId: string): Promise<void> {
  await fetch("/api/acp/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId }),
    keepalive: true,
  }).catch(() => {});
}

/** `nonce`: the one BytNode-AI's own confirmation came with, if any. */
export async function answerAcpPermission(conversationId: string, callId: string, allow: boolean, always: boolean, nonce?: string): Promise<void> {
  await fetch("/api/acp/permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, callId, allow, always, ...(nonce ? { nonce } : {}) }),
  }).catch(() => {});
}

export async function closeAcpConversation(conversationId: string): Promise<void> {
  await fetch("/api/acp/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, close: true }),
    keepalive: true,
  }).catch(() => {});
}
