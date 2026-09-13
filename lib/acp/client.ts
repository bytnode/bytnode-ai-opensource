import type { AcpAgentId } from "./agents";
import type { WireEvent } from "./wire";

/* ---------------------------------------------------------------------------
   Ce que le navigateur voit d'un tour par abonnement.

   Un tour = une requete qui reste ouverte et raconte (NDJSON). Les demandes
   de permission arrivent dans ce flux et se repondent par une autre
   requete ; interrompre = fermer le flux (le serveur annule chez l'agent).
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
  bytnodeKey: string;
};

export class AcpError extends Error {}

export async function runAcpTurn(input: AcpTurnInput, onEvent: (e: WireEvent) => void, signal: AbortSignal): Promise<void> {
  const { bytnodeKey, ...body } = input;
  const res = await fetch("/api/acp/prompt", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bytnode-key": bytnodeKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Le serveur a répondu ${res.status}.`;
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* pas de JSON */
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

export async function answerAcpPermission(conversationId: string, callId: string, allow: boolean, always: boolean): Promise<void> {
  await fetch("/api/acp/permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, callId, allow, always }),
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
