import { transportHeaders, type Transport } from "@/lib/tools/transport";
import type { AcpAgentId } from "./agents";
import type { WireEvent } from "./wire";

/* ---------------------------------------------------------------------------
   What the browser sees of a subscription turn.

   A turn = one request that stays open and narrates (NDJSON). Permission
   requests arrive in this stream and are answered through another request;
   interrupting = closing the stream (the server cancels on the agent's
   side).
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

export async function runAcpTurn(input: AcpTurnInput, onEvent: (e: WireEvent) => void, signal: AbortSignal): Promise<void> {
  const { transport, ...body } = input;
  const res = await fetch("/api/acp/prompt", {
    method: "POST",
    headers: { "content-type": "application/json", ...transportHeaders({ ...transport, openrouterKey: "" }) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `The server answered ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* no JSON */
    }
    throw new AcpError(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: WireEvent;
      try {
        event = JSON.parse(line) as WireEvent;
      } catch {
        continue;
      }
      if (event.type === "error") throw new AcpError(event.message);
      onEvent(event);
    }
  }
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
