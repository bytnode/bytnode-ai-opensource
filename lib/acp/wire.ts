import type { AgentEvent } from "@/lib/agent/events";
import type { PermissionOption } from "@agentclientprotocol/sdk";

/* What travels from the server to the browser during an ACP turn: the
   thread's events, plus what only exists here — the session id to
   remember, a permission request to show on screen, a call that refines
   its arguments after the fact. Shared browser / server. */
export type WireEvent =
  | AgentEvent
  | { type: "session"; sessionId: string }
  /** `nonce`: set on BytNode-AI's own confirmation of a money action; the
      answer must carry it back (only this stream ever saw it). */
  | { type: "permission"; id: string; title: string; options: PermissionOption[]; nonce?: string }
  | { type: "tool_update"; id: string; name?: string; args?: Record<string, unknown>; line?: string };

/** The address of a plugin card inside an MCP tool result: the external
    agent passes the resource along, the translation turns it back into
    the thread's card. */
export const CARD_URI = "bytnode-ai://card";
